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
	getEmergencyContacts,
	updateEmergencyContacts,
	MAX_EMERGENCY_CONTACTS
} from '$lib/server/authentikAdmin';
import { validateProfileSubmission, validateEmergencyContactsSubmission } from '$lib/server/profileValidation';
import { clearSessionCookie } from '$lib/server/session';
import { logAuditEvent, listAuditEventsForTarget } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

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

	const [sessions, mfaDevices, mfaEnrollUrls, emergencyContacts] = await Promise.all([
		listSessions(profile.username),
		listMfaDevices(pk),
		getMfaEnrollUrls(),
		getEmergencyContacts(pk)
	]);

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

		// Read before writing, purely for the audit trail below — same reasoning as the admin
		// version of this same action.
		const before = await getUserProfile(pk).catch(() => null);
		const changed = await updateUserProfile(pk, { name: result.name, attributes: result.attributes });

		if (changed) {
			// result.attributes only holds the keys actually submitted (the "Divers" social fields
			// can be absent from the form entirely) — logging it alone as `after` would make an
			// untouched field look "removed" in the diff. Mirror updateUserProfile's own merge so
			// `after` reflects what's actually now stored, not just what this submission touched.
			logAuditEvent(
				{ sub: user.sub, label: displayName(user) },
				'user',
				'profile.update',
				{ pk },
				{
					before: before ? { name: before.name, attributes: before.attributes } : null,
					after: { name: result.name, attributes: { ...before?.attributes, ...result.attributes } }
				}
			);
		}

		return {
			success: true,
			changed,
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

	updateEmergencyContacts: async ({ request, locals }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;
		const result = validateEmergencyContactsSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, { emergencyContactsError: result.error, emergencyContacts: result.contacts });
		}

		const before = await getEmergencyContacts(pk).catch(() => null);

		try {
			await updateEmergencyContacts(pk, result.contacts);
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
			{ before: { contactCount: before?.length ?? null }, after: { contactCount: result.contacts.length } }
		);

		return { emergencyContactsSuccess: true, emergencyContacts: result.contacts };
	}
};
