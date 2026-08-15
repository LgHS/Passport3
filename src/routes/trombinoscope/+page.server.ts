import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listDirectoryMembers,
	getTrombinoscopeOptin,
	updateTrombinoscopeOptin,
	optinFromFormData
} from '$lib/server/authentikAdmin';
import { authentikPk } from '$lib/types';

// Same auth guard shape as /badge and /cotisation — never trust a client-submitted pk, always
// re-derive it from the authenticated session's sub.
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

	const [members, myOptin] = await Promise.all([listDirectoryMembers(), getTrombinoscopeOptin(pk)]);

	return { members, myOptin };
};

export const actions: Actions = {
	updateOptin: async ({ request, locals }) => {
		const pk = resolvePk(locals);
		const formData = await request.formData();
		const optin = optinFromFormData(formData);

		try {
			await updateTrombinoscopeOptin(pk, optin);
		} catch {
			return fail(500, { error: "La sauvegarde a échoué, réessayez." });
		}

		return { success: true, optin };
	}
};
