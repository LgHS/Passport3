import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { getComptaSettings, updateComptaSettings } from '$lib/server/compta/settings';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

export const load: PageServerLoad = async () => {
	return { settings: await getComptaSettings() };
};

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const delaiGraceJours = Number(formData.get('delaiGraceJours'));
		if (!Number.isInteger(delaiGraceJours) || delaiGraceJours < 0 || delaiGraceJours > 365) {
			return fail(400, { error: 'Délai de grâce invalide (0 à 365 jours).', delaiGraceJours });
		}
		await updateComptaSettings({ delaiGraceJours });
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.settings.update', {}, {
			delaiGraceJours
		});
		return { success: true, delaiGraceJours };
	}
};
