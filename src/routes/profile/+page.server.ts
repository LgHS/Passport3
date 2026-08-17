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
	updateNotificationPreferences
} from '$lib/server/authentikAdmin';
import { validateProfileSubmission } from '$lib/server/profileValidation';
import { clearSessionCookie } from '$lib/server/session';
import { authentikPk } from '$lib/types';

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

	const [sessions, mfaDevices, mfaEnrollUrls, notificationPreferences] = await Promise.all([
		listSessions(profile.username),
		listMfaDevices(pk),
		getMfaEnrollUrls(),
		getNotificationPreferences(pk)
	]);

	return {
		profile,
		fields: PROFILE_ATTRIBUTE_FIELDS,
		authentikAccountUrl: getAuthentikAccountUrl(),
		mfaEnrollUrls,
		sessions,
		mfaDevices,
		notificationPreferences
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const pk = resolvePk(locals);
		const result = validateProfileSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, {
				error: result.error,
				firstName: result.firstName,
				lastName: result.lastName,
				attributes: result.attributes
			});
		}

		const changed = await updateUserProfile(pk, { name: result.name, attributes: result.attributes });

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
		const profile = await getUserProfile(pk);
		const formData = await request.formData();
		const uuid = String(formData.get('uuid') ?? '');
		await revokeSession(profile.username, uuid);

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
		const formData = await request.formData();
		const devicePk = String(formData.get('pk') ?? '');
		await deleteMfaDevice(pk, devicePk);
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
			return fail(500, { notificationPreferencesError: 'La sauvegarde a échoué, réessayez.' });
		}

		return { notificationPreferencesSuccess: true, notificationPreferences: prefs };
	}
};
