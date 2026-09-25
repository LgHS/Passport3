import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getUserProfile,
	updateUserProfile,
	getAuthentikAccountUrl,
	getMfaEnrollUrls,
	PROFILE_ATTRIBUTE_FIELDS,
	listSessions,
	revokeSession,
	listMfaDevices,
	deleteMfaDevice,
	getNotificationPreferences,
	updateNotificationPreferences,
	getEmergencyContacts,
	updateEmergencyContacts,
	MAX_EMERGENCY_CONTACTS,
	getUsernameChangeInfo,
	updateUsername,
	revokeAllSessions,
	AuthentikUnavailableError
} from '$lib/server/authentikAdmin';
import { lookupMattermostUsername } from '$lib/server/mattermost';
import {
	validateProfileSubmission,
	validateEmergencyContactsSubmission,
	validateUsername
} from '$lib/server/profileValidation';
import { clearSessionCookie } from '$lib/server/session';
import { logAuditEvent, listAuditEventsForTarget } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

const AUTHENTIK_UNAVAILABLE_MESSAGE = 'Service temporairement indisponible. Réessayez dans quelques instants.';

function resolvePk(locals: App.Locals): number {
	if (!locals.user) {
		redirect(302, '/login');
	}
	const pk = authentikPk(locals.user);
	if (!pk) {
		error(500, 'Impossible de résoudre votre identifiant Authentik (sub).');
	}
	return pk;
}

export const load: PageServerLoad = async ({ locals, parent }) => {
	const pk = resolvePk(locals);

	// Reuse the profile the root layout already fetched (for the header avatar) instead of
	// hitting the Authentik API again for the same user.
	const { profile } = await parent();
	if (!profile) {
		error(500, 'Impossible de récupérer votre profil Authentik.');
	}

	let sessions,
		mfaDevices,
		mfaEnrollUrls,
		notificationPreferences,
		mattermost,
		emergencyContacts,
		usernameChangeInfo;
	try {
		[
			sessions,
			mfaDevices,
			mfaEnrollUrls,
			notificationPreferences,
			mattermost,
			emergencyContacts,
			usernameChangeInfo
		] = await Promise.all([
			listSessions(profile.username),
			listMfaDevices(pk),
			getMfaEnrollUrls(),
			getNotificationPreferences(pk),
			// Best-effort: a transient Mattermost hiccup shouldn't break the whole profile page,
			// same reasoning as the Authentik/Dolibarr .catch()s in +layout.server.ts. Unlike a
			// plain .catch(() => null), `unavailable` stays distinguishable from "no linked
			// account" — see feedback_distinguish-fetch-failure-from-empty.
			lookupMattermostUsername(profile.email),
			getEmergencyContacts(pk),
			getUsernameChangeInfo(pk)
		]);
	} catch (err) {
		if (err instanceof AuthentikUnavailableError) {
			error(503, AUTHENTIK_UNAVAILABLE_MESSAGE);
		}
		throw err;
	}

	// Synchronous (better-sqlite3), and cheap at this scale — no need to bundle into the
	// Promise.all above with the actual network calls.
	const auditEvents = listAuditEventsForTarget(pk);

	return {
		profile,
		fields: PROFILE_ATTRIBUTE_FIELDS,
		authentikAccountUrl: getAuthentikAccountUrl(),
		mfaEnrollUrls,
		sessions,
		mfaDevices,
		notificationPreferences,
		mattermostUsername: mattermost.username,
		mattermostUnavailable: mattermost.unavailable,
		emergencyContacts,
		nextUsernameChangeAllowedAt: usernameChangeInfo.nextChangeAllowedAt,
		maxEmergencyContacts: MAX_EMERGENCY_CONTACTS,
		auditEvents
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals, cookies }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;
		const formData = await request.formData();
		const result = validateProfileSubmission(formData);

		if (!result.ok) {
			return fail(400, {
				error: result.error,
				firstName: result.firstName,
				lastName: result.lastName,
				attributes: result.attributes
			});
		}

		// Username lives in this same form/submission (see ProfileForm.svelte's `username` prop)
		// rather than its own action — one "Enregistrer" covers both, per the user's own request.
		// `formData.has('username')` is only true on the member-facing /profile (the admin edit
		// form never renders that field), and only a value that actually differs from the current
		// one counts as "requesting a change" — resubmitting the same value must never restart the
		// cooldown or touch Authentik at all.
		const currentProfile = await getUserProfile(pk);
		const submittedUsername = formData.has('username') ? String(formData.get('username') ?? '').trim() : null;
		const usernameRequestedChange = submittedUsername !== null && submittedUsername !== currentProfile.username;

		if (usernameRequestedChange) {
			// Re-checked server-side, not trusted from whatever the client last rendered — the
			// cooldown only means anything if it can't be bypassed by replaying the form after the
			// client-side disabling wears off.
			const info = await getUsernameChangeInfo(pk);
			if (info.nextChangeAllowedAt) {
				return fail(400, {
					usernameError: `Vous devez attendre le ${new Date(info.nextChangeAllowedAt).toLocaleDateString('fr-BE')} avant de pouvoir modifier à nouveau votre nom d'utilisateur.`,
					firstName: result.firstName,
					lastName: result.lastName,
					attributes: result.attributes
				});
			}
			const usernameResult = validateUsername(submittedUsername!);
			if (!usernameResult.ok) {
				return fail(400, {
					usernameError: usernameResult.error,
					firstName: result.firstName,
					lastName: result.lastName,
					attributes: result.attributes
				});
			}
		}

		// before/after come from updateUserProfile()'s own internal read, not a separate call here
		// — that read is the one the merge/PATCH was actually based on, so the audit trail can't
		// drift from what was truly written (see ProfileMutationResult in authentikAdmin.ts).
		const mutation = await updateUserProfile(pk, { name: result.name, attributes: result.attributes });

		if (mutation.changed) {
			logAuditEvent(
				{ sub: user.sub, label: displayName(user) },
				'user',
				'profile.update',
				{ pk },
				{ before: mutation.before, after: mutation.after }
			);
		}

		let usernameError: string | undefined;
		let usernameMutation: { before: string; after: string } | undefined;
		if (usernameRequestedChange) {
			try {
				usernameMutation = await updateUsername(pk, submittedUsername!);
			} catch (err) {
				// Surfaces Authentik's own rejection reason (most likely a uniqueness conflict)
				// instead of a guessed message — authentikApiFetch's Error wraps the raw response
				// body after "failed (<status>): ", typically DRF-style {"field": ["message"]} JSON.
				// The profile fields above are already saved at this point; only the username part
				// failed, so this doesn't roll anything back — it just reports its own error.
				const message = err instanceof Error ? err.message : String(err);
				const bodyText = message.replace(/^Authentik API request to .* failed \(\d+\): /, '');
				usernameError = bodyText;
				try {
					const parsed = JSON.parse(bodyText) as Record<string, unknown>;
					// Authentik's own "unique" validator message ("Ce champ doit être unique.") doesn't
					// say which field, or that it's the username specifically — friendlier wording for
					// that one specific, common case, otherwise pass its message through as-is.
					if (
						'username' in parsed &&
						[parsed.username].flat().some((m) => typeof m === 'string' && /unique/i.test(m))
					) {
						usernameError = 'Ce nom d’utilisateur est déjà utilisé.';
					} else {
						const messages = Object.values(parsed).flat();
						if (messages.length > 0) {
							usernameError = messages.join(' ');
						}
					}
				} catch {
					// Not JSON, or an unexpected shape — the raw text may contain the API's internal
					// path or wording, so it isn't shown to the member; log it server-side instead and
					// fall back to a generic message.
					console.error('[updateProfile] unrecognized username update error from Authentik:', bodyText);
					usernameError = "Le changement de nom d'utilisateur a échoué. Merci de réessayer plus tard.";
				}
			}
		}

		if (usernameMutation) {
			logAuditEvent(
				{ sub: user.sub, label: displayName(user) },
				'user',
				'profile.username.update',
				{ pk },
				{ before: { username: usernameMutation.before }, after: { username: usernameMutation.after } }
			);

			// Matches the warning shown before this change: every session and linked service login
			// is invalidated, not just this one — the member has to sign back in everywhere with the
			// new username. Revoked under the *new* username: listSessions()'s user__username filter
			// is a live join against Authentik's current username column, and updateUsername() has
			// already renamed the user by this point, so querying with the old name would match zero
			// sessions. Authentik's authenticated_sessions endpoint exposes no pk-based filter, so
			// user__username is the only option, and it must be the post-rename value.
			//
			// The rename itself already succeeded by this point, so a failure here (e.g. Authentik
			// slow or briefly unavailable) must not surface as a 500 — it's logged and swallowed, and
			// the member is still redirected to log back in under their new username either way.
			try {
				await revokeAllSessions(usernameMutation.after);
			} catch (err) {
				console.error('[updateProfile] failed to revoke sessions after username change:', err);
			}
			// `redirect()` throws, so it must stay outside the try/catch above — that catch is for
			// updateUsername()'s own failure, not for this.
			clearSessionCookie(cookies);
			redirect(302, '/login');
		}

		// Only ever reached when the username either wasn't part of this submission, or matched a
		// rejection above — a successful change always redirects (see the block above) before
		// getting here, so there's no "new username" to echo back at this point.
		return {
			success: true,
			changed: mutation.changed,
			firstName: result.firstName,
			lastName: result.lastName,
			attributes: result.attributes,
			usernameError
		};
	},

	revokeSession: async ({ request, locals, cookies }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;
		const profile = await getUserProfile(pk);
		const formData = await request.formData();
		const uuid = String(formData.get('uuid') ?? '');
		await revokeSession(profile.username, uuid);

		logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'session.revoke',
			{ pk },
			{ sessionUuid: uuid }
		);

		// If that was the last Authentik session, bring Passport3's own session in line rather
		// than leaving the member logged in here with nothing left on Authentik's side.
		const remaining = await listSessions(profile.username);
		if (remaining.length === 0) {
			clearSessionCookie(cookies);
			redirect(302, '/login');
		}

		// Distinct from updateProfile's `success` — /profile has several forms posting to the same
		// page, so they'd all share one `form` result otherwise: ProfileForm.svelte's toast effect
		// reacts to `form?.success`, and a bare `{ success: true }` here was triggering *its* success
		// message ("Aucune modification à enregistrer.") whenever a session was revoked.
		return { sessionRevoked: true };
	},

	deleteMfaDevice: async ({ request, locals }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;
		const formData = await request.formData();
		const devicePk = String(formData.get('pk') ?? '');
		await deleteMfaDevice(pk, devicePk);

		logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'mfaDevice.delete',
			{ pk },
			{ devicePk }
		);

		// Same reasoning as revokeSession above — kept distinct from `success` on purpose.
		return { mfaDeviceDeleted: true };
	},

	updateNotificationPreferences: async ({ request, locals }) => {
		const pk = resolvePk(locals);
		const formData = await request.formData();
		const prefs = { mattermostDm: formData.has('mattermostDm') };

		try {
			await updateNotificationPreferences(pk, prefs);
		} catch {
			// The client toggles optimistically before this action even runs — on failure, echo
			// back the value from *before* the attempted change (its logical negation, since a
			// checkbox toggle always flips) so the client can resync instead of leaving the toggle
			// showing a state that was never actually saved.
			return fail(500, {
				notificationPreferencesError: 'La sauvegarde a échoué, réessayez.',
				notificationPreferences: { mattermostDm: !prefs.mattermostDm }
			});
		}

		return { notificationPreferencesSuccess: true, notificationPreferences: prefs };
	},

	updateEmergencyContacts: async ({ request, locals }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;
		const result = validateEmergencyContactsSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, { emergencyContactsError: result.error, emergencyContacts: result.contacts });
		}

		let mutation;
		try {
			mutation = await updateEmergencyContacts(pk, result.contacts);
		} catch {
			return fail(500, {
				emergencyContactsError: "La sauvegarde des contacts d'urgence a échoué, réessayez.",
				emergencyContacts: result.contacts
			});
		}

		// Same privacy posture as the admin version — count only, never the actual contacts.
		logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'emergencyContacts.update',
			{ pk },
			{ before: { contactCount: mutation.before.length }, after: { contactCount: mutation.after.length } }
		);

		return { emergencyContactsSuccess: true, emergencyContacts: result.contacts };
	}
};
