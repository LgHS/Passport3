import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getRfidUid, regenerateRfidUid } from '$lib/server/authentikAdmin';
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

export const load: PageServerLoad = async ({ locals }) => {
	const pk = resolvePk(locals);

	// First visit: no rfid_uid attribute yet on this Authentik user, so provision one now
	// rather than showing an empty badge identifier.
	const uuid = (await getRfidUid(pk)) ?? (await regenerateRfidUid(pk));

	return { uuid };
};

export const actions: Actions = {
	regenerate: async ({ locals }) => {
		const pk = resolvePk(locals);
		const uuid = await regenerateRfidUid(pk);
		return { success: true, uuid };
	}
};
