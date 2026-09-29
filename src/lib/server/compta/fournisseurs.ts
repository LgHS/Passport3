import { getDb } from '$lib/server/db';
import { attachPdf, attachUbl, createFacture, type Facture } from './factures';
import { createTiers } from './tiers';
import { parseIsoDate } from './dates';
import type { UblFournisseur, UblLu } from './ubl';

// Registering a supplier's invoice from its UBL file — shared by the manual upload
// (/compta/factures/nouvelle) and by the documents collected from the mailbox (reception.ts).

function numeroEntreprise(f: UblFournisseur): { digits: string; formatted: string | null } {
	// Belgian enterprise number, with or without the BE prefix of the VAT number.
	const digits = (f.numeroEntreprise ?? f.tva ?? '').replace(/\D/g, '');
	const formatted = digits.length === 10 ? `${digits.slice(0, 4)}.${digits.slice(4, 7)}.${digits.slice(7)}` : null;
	return { digits, formatted };
}

// The tiers a UBL's supplier block designates — by enterprise number first, then exact name —
// or null when the books don't know it yet.
export async function trouverFournisseur(f: UblFournisseur): Promise<{ id: number; nom: string } | null> {
	const sql = await getDb();
	const { digits, formatted } = numeroEntreprise(f);
	const [found] = await sql<{ id: number; nom: string }[]>`
		SELECT id, nom FROM tiers
		WHERE (${formatted}::text IS NOT NULL AND regexp_replace(coalesce(numero_entreprise, ''), '[^0-9]', '', 'g') = ${digits})
		   OR lower(nom) = lower(${f.nom})
		ORDER BY numero_entreprise IS NULL
		LIMIT 1
	`;
	return found ?? null;
}

// Same, creating the tiers when it doesn't exist. A tiers created this way carries what the file
// says; the treasurer completes it.
export async function tiersPourFournisseur(f: UblFournisseur, origine = 'Créé depuis un fichier UBL.'): Promise<number> {
	const found = await trouverFournisseur(f);
	if (found) return found.id;
	const { formatted } = numeroEntreprise(f);
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
		notes: origine
	});
	return created.id;
}

// A received invoice with this supplier and this number already in the books, if any — the same
// document arriving twice (uploaded by hand, then emailed by Doccle) must not be paid twice.
export async function factureRecueExistante(tiersId: number, numero: string): Promise<number | null> {
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		SELECT id FROM factures
		WHERE sens = 'recue' AND tiers_id = ${tiersId} AND lower(numero) = lower(${numero.trim()}) AND statut <> 'annulee'
		LIMIT 1
	`;
	return row?.id ?? null;
}

// Registers the invoice a parsed UBL describes, with its files. Throws FactureError.
export async function enregistrerFactureUbl(lu: UblLu, tiersId: number, fichiers: { ubl: Buffer; pdf: Buffer | null }): Promise<Facture> {
	const facture = await createFacture(
		{
			sens: 'recue',
			tiersId,
			dateEmission: parseIsoDate(lu.dateEmission),
			dateEcheance: lu.dateEcheance ? parseIsoDate(lu.dateEcheance) : null,
			objet: null,
			note: null,
			numero: lu.numero,
			lignes: lu.lignes,
			cotisation: null
		},
		lu.type
	);
	await attachUbl(facture.id, fichiers.ubl);
	const pdf = fichiers.pdf ?? lu.pdf;
	if (pdf) await attachPdf(facture.id, pdf);
	return facture;
}
