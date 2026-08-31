import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserGroups } from '$lib/server/authentikAdmin';
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
	const groups = await getUserGroups(pk);
	return { groups };
};
