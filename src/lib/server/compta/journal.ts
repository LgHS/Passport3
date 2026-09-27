import { getDb } from '$lib/server/db';
import { brusselsToday, parseIsoDate, parseMoney } from './dates';

// The small-ASBL simplified books — docs/compta.md, "Sorties comptables": for one calendar year,
// the journal of receipts and expenses (every movement of every account, internal transfers left
// out), the receipts/expenses statement by heading, and the statement of assets and liabilities
// at year end. Headings come from what each movement was matched against (lettrages); what isn't
// matched yet is shown apart so the treasury knows what's left to qualify before closing.

export type Rubrique =
	| 'cotisations'
	| 'dons_sponsoring'
	| 'ventes_prestations'
	| 'autres_recettes'
	| 'achats_services'
	| 'remboursements_frais'
	| 'autres_depenses'
	| 'non_lettre';

export const RUBRIQUE_LABEL: Record<Rubrique, string> = {
	cotisations: 'Cotisations',
	dons_sponsoring: 'Dons et sponsoring',
	ventes_prestations: 'Ventes et prestations',
	autres_recettes: 'Autres recettes',
	achats_services: 'Achats et services',
	remboursements_frais: 'Remboursements de frais',
	autres_depenses: 'Autres dépenses',
	non_lettre: 'Non lettré'
};

export const RECETTES: Rubrique[] = ['cotisations', 'dons_sponsoring', 'ventes_prestations', 'autres_recettes'];
export const DEPENSES: Rubrique[] = ['achats_services', 'remboursements_frais', 'autres_depenses'];

export interface JournalLigne {
	id: number;
	date: Date;
	compte: string;
	libelle: string;
	contrepartie: string | null;
	montant: number;
	// One line per allocation; a movement matched against two invoices shows twice, each with its
	// part. Unmatched remainder shows as its own line under 'non_lettre'.
	rubrique: Rubrique;
	detail: string | null;
}

export interface Journal {
	annee: number;
	lignes: JournalLigne[];
	recettes: Record<Rubrique, number>;
	depenses: Record<Rubrique, number>;
	totalRecettes: number;
	totalDepenses: number;
	resultat: number;
	patrimoine: {
		date: Date;
		comptes: { nom: string; type: string; solde: number }[];
		totalComptes: number;
		creances: number;
		dettesFournisseurs: number;
		dettesFrais: number;
	};
}

interface LigneRow {
	id: number;
	date_valeur: string;
	compte: string;
	libelle: string;
	contrepartie_nom: string | null;
	contrepartie_iban: string | null;
	montant: string;
	lettre_montant: string | null;
	cible_type: string | null;
	cible_libelle: string | null;
	facture_sens: string | null;
	facture_type: string | null;
	facture_numero: string | null;
	facture_cotisation_type: string | null;
	cotisation_type: string | null;
	note_libelle: string | null;
}

function rubriqueDe(r: LigneRow, montant: number): Rubrique {
	if (r.cible_type === null) return 'non_lettre';
	if (r.cible_type === 'cotisation') return r.cotisation_type === 'sponsoring' ? 'dons_sponsoring' : 'cotisations';
	if (r.cible_type === 'note_de_frais') return 'remboursements_frais';
	if (r.cible_type === 'facture') {
		if (r.facture_sens === 'recue') return 'achats_services';
		if (r.facture_cotisation_type === 'sponsoring') return 'dons_sponsoring';
		if (r.facture_cotisation_type === 'facturee') return 'cotisations';
		// A credit note refund is money out on an issued document: still "ventes", negative.
		return 'ventes_prestations';
	}
	return montant >= 0 ? 'autres_recettes' : 'autres_depenses';
}

function detailDe(r: LigneRow): string | null {
	if (r.cible_type === 'facture') return `Facture ${r.facture_numero ?? ''}${r.facture_type === 'note_de_credit' ? ' (NC)' : ''}`.trim();
	if (r.cible_type === 'cotisation') return 'Cotisation';
	if (r.cible_type === 'note_de_frais') return `Note de frais — ${r.note_libelle ?? ''}`;
	if (r.cible_type === 'autre') return r.cible_libelle;
	return null;
}

export async function getJournal(annee: number): Promise<Journal> {
	const sql = await getDb();
	const debut = `${annee}-01-01`;
	const finExclusive = `${annee + 1}-01-01`;

	// One row per (movement, allocation); a movement with no allocation yields one row with NULLs.
	const rows = await sql<LigneRow[]>`
		SELECT m.id, m.date_valeur::text AS date_valeur, c.nom AS compte, m.libelle, m.contrepartie_nom, m.contrepartie_iban, m.montant,
		       l.montant AS lettre_montant, l.cible_type, l.libelle AS cible_libelle,
		       f.sens AS facture_sens, f.type AS facture_type, f.numero AS facture_numero, f.cotisation_type AS facture_cotisation_type,
		       co.type AS cotisation_type, n.libelle AS note_libelle
		FROM mouvements m
		JOIN comptes c ON c.id = m.compte_id
		LEFT JOIN lettrages l ON l.mouvement_id = m.id
		LEFT JOIN factures f ON l.cible_type = 'facture' AND f.id = l.cible_id
		LEFT JOIN cotisations co ON l.cible_type = 'cotisation' AND co.id = l.cible_id
		LEFT JOIN notes_de_frais n ON l.cible_type = 'note_de_frais' AND n.id = l.cible_id
		WHERE m.transfert_id IS NULL AND m.date_valeur >= ${debut}::date AND m.date_valeur < ${finExclusive}::date
		ORDER BY m.date_valeur, m.id, l.id
	`;

	const lignes: JournalLigne[] = [];
	const zero = () => Object.fromEntries(Object.keys(RUBRIQUE_LABEL).map((k) => [k, 0])) as Record<Rubrique, number>;
	const recettes = zero();
	const depenses = zero();
	// Track how much of each movement its allocations cover, to emit the unmatched remainder.
	const restes = new Map<number, { row: LigneRow; reste: number }>();

	for (const r of rows) {
		const total = parseMoney(r.montant);
		const sign = total < 0 ? -1 : 1;
		if (!restes.has(r.id)) restes.set(r.id, { row: r, reste: Math.abs(total) });
		if (r.cible_type === null) continue;
		const part = parseMoney(r.lettre_montant) * sign;
		restes.get(r.id)!.reste = Math.round((restes.get(r.id)!.reste - Math.abs(part)) * 100) / 100;
		const rubrique = rubriqueDe(r, part);
		lignes.push({
			id: r.id,
			date: parseIsoDate(r.date_valeur),
			compte: r.compte,
			libelle: r.libelle,
			contrepartie: r.contrepartie_nom ?? r.contrepartie_iban,
			montant: part,
			rubrique,
			detail: detailDe(r)
		});
		if (part >= 0) recettes[rubrique] += part;
		else depenses[rubrique] += -part;
	}
	for (const { row, reste } of restes.values()) {
		if (reste <= 0.005) continue;
		const sign = parseMoney(row.montant) < 0 ? -1 : 1;
		const part = reste * sign;
		lignes.push({
			id: row.id,
			date: parseIsoDate(row.date_valeur),
			compte: row.compte,
			libelle: row.libelle,
			contrepartie: row.contrepartie_nom ?? row.contrepartie_iban,
			montant: part,
			rubrique: 'non_lettre',
			detail: null
		});
		if (part >= 0) recettes.non_lettre += part;
		else depenses.non_lettre += -part;
	}
	lignes.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id - b.id);

	const round = (n: number) => Math.round(n * 100) / 100;
	for (const k of Object.keys(recettes) as Rubrique[]) {
		recettes[k] = round(recettes[k]);
		depenses[k] = round(depenses[k]);
	}
	const totalRecettes = round(Object.values(recettes).reduce((a, b) => a + b, 0));
	const totalDepenses = round(Object.values(depenses).reduce((a, b) => a + b, 0));

	// Statement of assets at year end (or today for the current year, since nothing later exists).
	const cloture = new Date(Math.min(Date.UTC(annee, 11, 31), brusselsToday().getTime()));
	const clotureIso = cloture.toISOString().slice(0, 10);
	const comptes = await sql<{ nom: string; type: string; solde: string }[]>`
		SELECT c.nom, c.type,
		       c.solde_ouverture + COALESCE((SELECT sum(m.montant) FROM mouvements m WHERE m.compte_id = c.id AND m.date_valeur <= ${clotureIso}::date), 0) AS solde
		FROM comptes c WHERE c.actif ORDER BY c.type, lower(c.nom)
	`;
	const [creances] = await sql<{ total: string }[]>`
		SELECT COALESCE(sum(total), 0) AS total FROM factures
		WHERE sens = 'emise' AND statut = 'validee' AND date_emission <= ${clotureIso}::date
	`;
	const [dettes] = await sql<{ total: string }[]>`
		SELECT COALESCE(sum(total), 0) AS total FROM factures
		WHERE sens = 'recue' AND statut = 'validee' AND date_emission <= ${clotureIso}::date
	`;
	const [frais] = await sql<{ total: string }[]>`
		SELECT COALESCE(sum(montant), 0) AS total FROM notes_de_frais WHERE statut = 'acceptee' AND date <= ${clotureIso}::date
	`;
	const comptesList = comptes.map((c) => ({ nom: c.nom, type: c.type, solde: parseMoney(c.solde) }));

	return {
		annee,
		lignes,
		recettes,
		depenses,
		totalRecettes,
		totalDepenses,
		resultat: round(totalRecettes - totalDepenses),
		patrimoine: {
			date: cloture,
			comptes: comptesList,
			totalComptes: round(comptesList.reduce((a, c) => a + c.solde, 0)),
			creances: parseMoney(creances.total),
			dettesFournisseurs: parseMoney(dettes.total),
			dettesFrais: parseMoney(frais.total)
		}
	};
}

// Years that have at least one movement, newest first — the year picker.
export async function anneesDisponibles(): Promise<number[]> {
	const sql = await getDb();
	const rows = await sql<{ annee: number }[]>`
		SELECT DISTINCT extract(year FROM date_valeur)::int AS annee FROM mouvements ORDER BY annee DESC
	`;
	return rows.map((r) => r.annee);
}

// Semicolon-separated, Belgian decimals, for the accountant's spreadsheet.
export function journalCsv(journal: Journal): string {
	const esc = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
	const num = (n: number) => n.toFixed(2).replace('.', ',');
	const lines = ['Date;Compte;Libellé;Contrepartie;Rubrique;Détail;Recette;Dépense'];
	for (const l of journal.lignes) {
		lines.push(
			[
				l.date.toISOString().slice(0, 10),
				esc(l.compte),
				esc(l.libelle),
				esc(l.contrepartie),
				esc(RUBRIQUE_LABEL[l.rubrique]),
				esc(l.detail),
				l.montant >= 0 ? num(l.montant) : '',
				l.montant < 0 ? num(-l.montant) : ''
			].join(';')
		);
	}
	return '﻿' + lines.join('\r\n') + '\r\n';
}
