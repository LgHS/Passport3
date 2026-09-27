import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorier, requireTresorierUser } from '$lib/server/auth';
import { createTiers, listTiers, tiersDisplayName } from '$lib/server/compta/tiers';
import { parseNature, tiersInputFromForm } from '$lib/server/compta/tiersForm';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

export const load: PageServerLoad = async ({ url }) => {
	const nature = parseNature(url.searchParams.get('nature'));
	return {
		tiers: (await listTiers({ nature: nature ?? undefined })).map((t) => ({ ...t, displayName: tiersDisplayName(t) })),
		nature
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireTresorier(locals);
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const parsed = tiersInputFromForm(formData);
		if (!parsed.ok) {
			return fail(400, { error: parsed.error, values: Object.fromEntries(formData) as Record<string, string> });
		}
		const tiers = await createTiers(parsed.input);
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.tiers.create', {}, {
			tiersId: tiers.id,
			nom: tiersDisplayName(tiers)
		});
		redirect(303, `/compta/tiers/${tiers.id}`);
	}
};
