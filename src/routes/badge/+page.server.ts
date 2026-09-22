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

	// Pure read — `null` means no badge provisioned yet, left to the page to offer a "Générer mon
	// badge" action instead of the load() itself writing on a GET. Prefetching (SvelteKit's own
	// hover/viewport preload) or a crawler hitting this page would otherwise silently mint a badge
	// nobody asked for.
	const uuid = await getRfidUid(pk);

	return { uuid };
};

export const actions: Actions = {
	regenerate: async ({ locals }) => {
		const pk = resolvePk(locals);
		const uuid = await regenerateRfidUid(pk);
		return { success: true, uuid };
	}
};
