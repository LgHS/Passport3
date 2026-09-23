import { error, fail, redirect } from '@sveltejs/kit';
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
		// Pure read — `null` means no badge provisioned yet, left to the page to offer a "Générer
		// mon badge" action instead of the load() itself writing on a GET. Prefetching (SvelteKit's
		// own hover/viewport preload) or a crawler hitting this page would otherwise silently mint
		// a badge nobody asked for.
		const uuid = await getRfidUid(pk);
		return { uuid };
	} catch (err) {
		if (err instanceof AuthentikUnavailableError) {
			error(503, AUTHENTIK_UNAVAILABLE_MESSAGE);
		}
		throw err;
	}
};

export const actions: Actions = {
	regenerate: async ({ request, locals }) => {
		const pk = resolvePk(locals);

		// The client only disables the button until the checkbox is checked — that's UI, not
		// enforcement. A badge already exists here is a real, irreversible credential
		// invalidation, so the confirmation itself must also be checked server-side, or a direct
		// POST to this action (devtools, curl with a valid session, a stray script) could
		// invalidate it with no confirmation at all. A first-time generation has nothing to lose,
		// so it's deliberately exempt.
		const existingUuid = await getRfidUid(pk);
		if (existingUuid !== null) {
			const formData = await request.formData();
			if (!formData.has('confirmRegenerate')) {
				return fail(400, {
					error: 'Confirmation manquante pour régénérer un badge existant.'
				});
			}
		}

		const uuid = await regenerateRfidUid(pk);
		return { success: true, uuid };
	}
};
