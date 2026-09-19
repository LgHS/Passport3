import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listDirectoryMembers,
	getTrombinoscopeOptin,
	updateTrombinoscopeOptin,
	optinFromFormData
} from '$lib/server/authentikAdmin';
import { logAuditEvent } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

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
		const user = locals.user!;
		const formData = await request.formData();
		const optin = optinFromFormData(formData);

		const before = await getTrombinoscopeOptin(pk);

		try {
			await updateTrombinoscopeOptin(pk, optin);
		} catch {
			return fail(500, { error: "La sauvegarde a échoué, réessayez." });
		}

		logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'trombinoscope.optin.update',
			{ pk },
			{ before: { ...before }, after: { ...optin } }
		);

		return { success: true, optin };
	}
};
