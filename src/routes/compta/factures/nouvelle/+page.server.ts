import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { attachPdf, createFacture, FactureError } from '$lib/server/compta/factures';
import { enregistrerFactureUbl, factureRecueExistante, tiersPourFournisseur } from '$lib/server/compta/fournisseurs';
import { parseUbl, UblError } from '$lib/server/compta/ubl';
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
	// A received invoice straight from the supplier's UBL file: the tiers is matched or created,
	// the invoice registered with its lines, and the file (plus any embedded PDF) kept.
	importerUbl: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const file = formData.get('ubl');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choisissez un fichier UBL (.xml).' });
		if (file.size > MAX_PDF_BYTES) return fail(400, { error: 'Fichier trop volumineux (10 Mo max).' });
		const bytes = Buffer.from(await file.arrayBuffer());

		let lu;
		try {
			lu = parseUbl(bytes.toString('utf8'));
		} catch (err) {
			if (err instanceof UblError) return fail(400, { error: err.message });
			throw err;
		}
		const tiersId = await tiersPourFournisseur(lu.fournisseur);
		const existante = await factureRecueExistante(tiersId, lu.numero);
		if (existante) {
			return fail(400, { error: `La facture ${lu.numero} de ce fournisseur est déjà enregistrée.`, existante });
		}
		let id: number;
		try {
			id = (await enregistrerFactureUbl(lu, tiersId, { ubl: bytes, pdf: null })).id;
		} catch (err) {
			if (err instanceof FactureError) return fail(400, { error: err.message });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.facture.importUbl', {}, {
			factureId: id,
			tiersId,
			numero: lu.numero
		});
		redirect(303, `/compta/factures/${id}`);
	},

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
