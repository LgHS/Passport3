import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { attachPdf, attachUbl, createFacture, FactureError } from '$lib/server/compta/factures';
import { parseUbl, UblError } from '$lib/server/compta/ubl';
import { createTiers } from '$lib/server/compta/tiers';
import { getDb } from '$lib/server/db';
import { parseIsoDate } from '$lib/server/compta/dates';
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

// Finds the supplier a UBL names — by enterprise number, then VAT number, then exact name — or
// creates it. A tiers created this way carries what the file says; the treasurer completes it.
async function tiersPourFournisseur(f: Awaited<ReturnType<typeof parseUbl>>['fournisseur']): Promise<number> {
	const sql = await getDb();
	const digits = (f.numeroEntreprise ?? f.tva ?? '').replace(/\D/g, '');
	const formatted = digits.length === 10 ? `${digits.slice(0, 4)}.${digits.slice(4, 7)}.${digits.slice(7)}` : null;
	const [found] = await sql<{ id: number }[]>`
		SELECT id FROM tiers
		WHERE (${formatted}::text IS NOT NULL AND regexp_replace(coalesce(numero_entreprise, ''), '\D', '', 'g') = ${digits})
		   OR lower(nom) = lower(${f.nom})
		ORDER BY numero_entreprise IS NULL
		LIMIT 1
	`;
	if (found) return found.id;
	const created = await createTiers({
		nature: 'personne_morale',
		nom: f.nom,
		prenom: null,
		email: f.email,
		telephone: null,
		adresse: f.adresse,
		codePostal: f.codePostal,
		ville: f.ville,
		pays: f.pays,
		numeroEntreprise: formatted ?? f.tva,
		iban: null,
		exempteCotisation: false,
		estClient: false,
		estFournisseur: true,
		actif: true,
		notes: 'Créé depuis un fichier UBL.'
	});
	return created.id;
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
		let id: number;
		try {
			const facture = await createFacture({
				sens: 'recue',
				tiersId,
				dateEmission: parseIsoDate(lu.dateEmission),
				dateEcheance: lu.dateEcheance ? parseIsoDate(lu.dateEcheance) : null,
				objet: null,
				note: null,
				numero: lu.numero,
				lignes: lu.lignes,
				cotisation: null
			});
			id = facture.id;
		} catch (err) {
			if (err instanceof FactureError) return fail(400, { error: err.message });
			throw err;
		}
		await attachUbl(id, bytes);
		if (lu.pdf) await attachPdf(id, lu.pdf);
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
