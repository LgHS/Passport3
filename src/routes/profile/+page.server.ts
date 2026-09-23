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
	AuthentikUnavailableError
} from '$lib/server/authentikAdmin';
import { lookupMattermostUsername } from '$lib/server/mattermost';
import { validateProfileSubmission, validateEmergencyContactsSubmission } from '$lib/server/profileValidation';
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

	let sessions, mfaDevices, mfaEnrollUrls, notificationPreferences, mattermost, emergencyContacts;
	try {
		[sessions, mfaDevices, mfaEnrollUrls, notificationPreferences, mattermost, emergencyContacts] =
			await Promise.all([
				listSessions(profile.username),
				listMfaDevices(pk),
				getMfaEnrollUrls(),
				getNotificationPreferences(pk),
				// Best-effort: a transient Mattermost hiccup shouldn't break the whole profile page,
				// same reasoning as the Authentik/Dolibarr .catch()s in +layout.server.ts. Unlike a
				// plain .catch(() => null), `unavailable` stays distinguishable from "no linked
				// account" — see feedback_distinguish-fetch-failure-from-empty.
				lookupMattermostUsername(profile.email),
				getEmergencyContacts(pk)
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
		maxEmergencyContacts: MAX_EMERGENCY_CONTACTS,
		auditEvents
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;
		const result = validateProfileSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, {
				error: result.error,
				firstName: result.firstName,
				lastName: result.lastName,
				attributes: result.attributes
			});
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

		return {
			success: true,
			changed: mutation.changed,
			firstName: result.firstName,
			lastName: result.lastName,
			attributes: result.attributes
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
