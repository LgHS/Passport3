import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getRfidUid, regenerateRfidUid, AuthentikUnavailableError } from '$lib/server/authentikAdmin';
import { authentikPk } from '$lib/types';

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

export const load: PageServerLoad = async ({ locals }) => {
	const pk = resolvePk(locals);

	try {
		// First visit: no rfid_uid attribute yet on this Authentik user, so provision one now
		// rather than showing an empty badge identifier.
		const uuid = (await getRfidUid(pk)) ?? (await regenerateRfidUid(pk));
		return { uuid };
	} catch (err) {
		if (err instanceof AuthentikUnavailableError) {
			error(503, AUTHENTIK_UNAVAILABLE_MESSAGE);
		}
		throw err;
	}
};

export const actions: Actions = {
	regenerate: async ({ locals }) => {
		const pk = resolvePk(locals);
		const uuid = await regenerateRfidUid(pk);
		return { success: true, uuid };
	}
};
