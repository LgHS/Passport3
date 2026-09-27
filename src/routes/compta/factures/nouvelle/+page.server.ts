import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { attachPdf, createFacture, FactureError } from '$lib/server/compta/factures';
import { factureInputFromForm } from '$lib/server/compta/factureForm';
import { listTiers, tiersDisplayName } from '$lib/server/compta/tiers';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

// 10 MB — a scanned supplier invoice, not a photo archive.
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export const load: PageServerLoad = async ({ url }) => {
	const tiers = await listTiers({ actifOnly: true });
	return {
		tiers: tiers.map((t) => ({ id: t.id, nom: tiersDisplayName(t), nature: t.nature })),
		// /compta/tiers/[id] links here with the tiers preselected.
		preselectedTiersId: url.searchParams.get('tiers') ?? null
	};
};

// Echo the typed values on failure, in the form's own field names (lines as parallel arrays).
function echo(formData: FormData) {
	const values: Record<string, string> = {};
	for (const [k, v] of formData.entries()) if (typeof v === 'string' && !k.startsWith('ligne_')) values[k] = v;
	const libelles = formData.getAll('ligne_libelle').map(String);
	const quantites = formData.getAll('ligne_quantite').map(String);
	const prix = formData.getAll('ligne_prix').map(String);
	return { values, lignes: libelles.map((libelle, i) => ({ libelle, quantite: quantites[i] ?? '1', prix: prix[i] ?? '' })) };
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const parsed = factureInputFromForm(formData);
		if (!parsed.ok) return fail(400, { error: parsed.error, ...echo(formData) });

		const pdf = formData.get('pdf');
		if (pdf instanceof File && pdf.size > 0) {
			if (pdf.type !== 'application/pdf') return fail(400, { error: 'Le fichier doit être un PDF.', ...echo(formData) });
			if (pdf.size > MAX_PDF_BYTES) return fail(400, { error: 'PDF trop volumineux (10 Mo max).', ...echo(formData) });
		}

		let id: number;
		try {
			const facture = await createFacture(parsed.input);
			id = facture.id;
			if (facture.sens === 'recue' && pdf instanceof File && pdf.size > 0) {
				await attachPdf(id, Buffer.from(await pdf.arrayBuffer()));
			}
		} catch (err) {
			if (err instanceof FactureError) return fail(400, { error: err.message, ...echo(formData) });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.facture.create', {}, {
			factureId: id,
			sens: parsed.input.sens,
			tiersId: parsed.input.tiersId
		});
		redirect(303, `/compta/factures/${id}`);
	}
};
