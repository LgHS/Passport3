import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserGroups, AuthentikUnavailableError } from '$lib/server/authentikAdmin';
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
		const groups = await getUserGroups(pk);
		return { groups };
	} catch (err) {
		if (err instanceof AuthentikUnavailableError) {
			error(503, AUTHENTIK_UNAVAILABLE_MESSAGE);
		}
		throw err;
	}
};
