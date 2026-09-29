import PDFDocument from 'pdfkit';
import { getDb } from '$lib/server/db';
import { AVOIRS, DETTES, DROITS, ENGAGEMENTS, LIGNES_SAISIES, type LignePatrimoine } from '$lib/comptesAnnuels';
import { RUBRIQUE_LABEL, RUBRIQUES_DEPENSES, RUBRIQUES_RECETTES } from '$lib/rubriques';
import { parseIsoDate, toIsoDate } from './dates';
import type { Journal } from './journal';
import type { ComptaSettings } from './settings';

// The annual accounts of a small association keeping simplified accounts, in the official
// minimum model (arrêté royal du 29 avril 2019, annexe 8) — docs/compta.md, "Sorties comptables":
// the statement of receipts and expenses, and the annexe with its five points, of which the
// statement of assets. What the books know comes from journal.ts; the rest (valuation rules,
// inventory, rights and commitments) is typed by the treasurer and kept per year in
// comptes_annuels (migration 27).

export interface ComptesAnnuelsSaisie {
	reglesEvaluation: string;
	adaptationRegles: string;
	informationsComplementaires: string;
	// By line key ($lib/comptesAnnuels.ts). Missing = 0.
	montants: Record<string, number>;
	droitsEngagementsTexte: string;
	approuvesLe: Date | null;
}

export interface ComptesAnnuels extends ComptesAnnuelsSaisie {
	annee: number;
	updatedAt: Date | null;
	updatedBy: string | null;
}

export const SAISIE_VIDE: ComptesAnnuelsSaisie = {
	reglesEvaluation: '',
	adaptationRegles: '',
	informationsComplementaires: '',
	montants: {},
	droitsEngagementsTexte: '',
	approuvesLe: null
};

interface Row {
	annee: number;
	updated_at: Date;
	updated_by: string;
	regles_evaluation: string;
	adaptation_regles: string;
	informations_complementaires: string;
	montants: Record<string, unknown>;
	droits_engagements_texte: string;
	approuves_le: string | null;
}

export async function getComptesAnnuels(annee: number): Promise<ComptesAnnuels> {
	const sql = await getDb();
	const [r] = await sql<Row[]>`
		SELECT annee, updated_at, updated_by, regles_evaluation, adaptation_regles, informations_complementaires,
		       montants, droits_engagements_texte, approuves_le::text AS approuves_le
		FROM comptes_annuels WHERE annee = ${annee}
	`;
	if (!r) return { annee, updatedAt: null, updatedBy: null, ...SAISIE_VIDE };
	const montants: Record<string, number> = {};
	for (const key of LIGNES_SAISIES) {
		const n = Number(r.montants[key]);
		if (Number.isFinite(n) && n !== 0) montants[key] = n;
	}
	return {
		annee,
		updatedAt: r.updated_at,
		updatedBy: r.updated_by,
		reglesEvaluation: r.regles_evaluation,
		adaptationRegles: r.adaptation_regles,
		informationsComplementaires: r.informations_complementaires,
		montants,
		droitsEngagementsTexte: r.droits_engagements_texte,
		approuvesLe: r.approuves_le ? parseIsoDate(r.approuves_le) : null
	};
}

export async function saveComptesAnnuels(annee: number, saisie: ComptesAnnuelsSaisie, actorLabel: string): Promise<void> {
	const sql = await getDb();
	const montants: Record<string, number> = {};
	for (const key of LIGNES_SAISIES) if (saisie.montants[key]) montants[key] = saisie.montants[key];
	await sql`
		INSERT INTO comptes_annuels (
			annee, updated_by, regles_evaluation, adaptation_regles, informations_complementaires, montants,
			droits_engagements_texte, approuves_le
		) VALUES (
			${annee}, ${actorLabel}, ${saisie.reglesEvaluation}, ${saisie.adaptationRegles}, ${saisie.informationsComplementaires},
			${sql.json(montants)}, ${saisie.droitsEngagementsTexte}, ${saisie.approuvesLe ? toIsoDate(saisie.approuvesLe) : null}
		)
		ON CONFLICT (annee) DO UPDATE SET
			updated_at = now(), updated_by = EXCLUDED.updated_by, regles_evaluation = EXCLUDED.regles_evaluation,
			adaptation_regles = EXCLUDED.adaptation_regles, informations_complementaires = EXCLUDED.informations_complementaires,
			montants = EXCLUDED.montants, droits_engagements_texte = EXCLUDED.droits_engagements_texte,
			approuves_le = EXCLUDED.approuves_le
	`;
}

// ---------------------------------------------------------------------------------------------
// Amounts

export interface MontantLigne extends LignePatrimoine {
	// What the books say, for a `calcule` line.
	calculeMontant: number | null;
	// What the treasurer typed (an adjustment, for a `calcule` line).
	saisi: number;
	montant: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function montantsPatrimoine(journal: Journal, saisie: ComptesAnnuelsSaisie) {
	const calcules: Record<NonNullable<LignePatrimoine['calcule']>, number> = {
		liquidites: journal.patrimoine.totalComptes,
		creances: journal.patrimoine.creances,
		dettes_fournisseurs: journal.patrimoine.dettesFournisseurs,
		dettes_membres: journal.patrimoine.dettesFrais
	};
	const ligne = (l: LignePatrimoine): MontantLigne => {
		const calculeMontant = l.calcule ? calcules[l.calcule] : null;
		const saisi = l.titre ? 0 : (saisie.montants[l.key] ?? 0);
		return { ...l, calculeMontant, saisi, montant: round((calculeMontant ?? 0) + saisi) };
	};
	const total = (lignes: MontantLigne[]) => round(lignes.reduce((a, l) => a + l.montant, 0));
	const avoirs = AVOIRS.map(ligne);
	const dettes = DETTES.map(ligne);
	return {
		avoirs,
		dettes,
		droits: DROITS.map(ligne),
		engagements: ENGAGEMENTS.map(ligne),
		totalAvoirs: total(avoirs),
		totalDettes: total(dettes)
	};
}

// ---------------------------------------------------------------------------------------------
// PDF

const PAGE = { width: 595.28, height: 841.89, margin: 50 };
const WIDTH = PAGE.width - 2 * PAGE.margin;
const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'long', timeZone: 'UTC' });
const amountFormat = new Intl.NumberFormat('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// pdfkit's standard fonts are WinAnsi: the narrow no-break space Intl puts between thousands isn't
// in it.
const eur = (n: number) => amountFormat.format(n).replace(/[  ]/g, ' ');

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});
}

interface Cellule {
	label: string;
	montant: number | null;
	indent?: boolean;
	gras?: boolean;
}

export async function renderComptesAnnuelsPdf(journal: Journal, comptes: ComptesAnnuels, settings: ComptaSettings): Promise<Buffer> {
	const doc = new PDFDocument({
		size: 'A4',
		margin: PAGE.margin,
		info: { Title: `Comptes annuels ${journal.annee} — ${settings.emetteurNom}`, Author: settings.emetteurNom }
	});
	const done = collect(doc);
	const left = PAGE.margin;
	const bottom = PAGE.height - PAGE.margin;
	const colWidth = WIDTH / 2;
	const amountWidth = 80;
	const rowHeight = 18;

	const ensure = (height: number) => {
		if (doc.y + height > bottom) doc.addPage();
	};
	const titre = (text: string) => {
		ensure(60);
		doc.moveDown(1).font('Helvetica-Bold').fontSize(12).text(text, left, doc.y, { width: WIDTH });
		doc.moveDown(0.5).font('Helvetica').fontSize(9.5);
	};
	const paragraphe = (text: string) => {
		doc.font('Helvetica').fontSize(9.5).text(text.trim() || 'Néant.', left, doc.y, { width: WIDTH, align: 'justify' });
	};

	// Two tables side by side, row by row, as the official model prints them.
	const tableau = (gauche: { titre: string; lignes: Cellule[] }, droite: { titre: string; lignes: Cellule[] }) => {
		const rows = Math.max(gauche.lignes.length, droite.lignes.length);
		const style = (c: Cellule) => doc.font(c.gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.indent ? 8.5 : 9.5);
		const labelWidth = (c: Cellule) => colWidth - amountWidth - (c.indent ? 19 : 10);
		// A row is as tall as its longest label, on either side.
		const hauteur = (c: Cellule | undefined) => (c ? style(c).heightOfString(c.indent ? `–  ${c.label}` : c.label, { width: labelWidth(c) }) + 9 : 0);
		const heights = Array.from({ length: rows }, (_, i) => Math.max(rowHeight, hauteur(gauche.lignes[i]), hauteur(droite.lignes[i])));
		ensure(rowHeight + heights.reduce((a, h) => a + h, 0) + 10);
		let y = doc.y;
		const cell = (x: number, h: number, c: Cellule | { entete: string } | undefined) => {
			doc.lineWidth(0.5).rect(x, y, colWidth, h).stroke();
			if (!c) return;
			if ('entete' in c) {
				doc.font('Helvetica-Bold').fontSize(9.5).text(c.entete, x + 5, y + 5, { width: colWidth - 10, lineBreak: false });
				return;
			}
			style(c).text(c.indent ? `–  ${c.label}` : c.label, x + (c.indent ? 14 : 5), y + 5, { width: labelWidth(c) });
			if (c.montant !== null) {
				doc.fontSize(9.5).text(eur(c.montant), x + colWidth - amountWidth - 5, y + 5, { width: amountWidth, align: 'right', lineBreak: false });
			}
		};
		cell(left, rowHeight, { entete: gauche.titre });
		cell(left + colWidth, rowHeight, { entete: droite.titre });
		y += rowHeight;
		for (let i = 0; i < rows; i++) {
			cell(left, heights[i], gauche.lignes[i]);
			cell(left + colWidth, heights[i], droite.lignes[i]);
			y += heights[i];
		}
		doc.x = left;
		doc.y = y + 6;
	};

	const nonLettre = journal.recettes.non_lettre + journal.depenses.non_lettre;

	// --- Identification -----------------------------------------------------------------------
	doc.font('Helvetica-Bold').fontSize(15).text('COMPTES ANNUELS', left, PAGE.margin, { width: WIDTH, align: 'center' });
	doc.font('Helvetica').fontSize(9.5).text('Schéma minimum normalisé des petites associations tenant une comptabilité simplifiée', { width: WIDTH, align: 'center' });
	doc.text('(arrêté royal du 29 avril 2019 portant exécution du Code des sociétés et des associations, annexe 8)', { width: WIDTH, align: 'center' });
	if (nonLettre > 0.005) {
		doc.moveDown(0.5).font('Helvetica-Bold').fillColor('#b91c1c');
		doc.text(`PROJET — ${eur(nonLettre)} EUR de mouvements ne sont pas encore rangés dans une rubrique.`, { width: WIDTH, align: 'center' });
		doc.fillColor('black');
	}
	doc.moveDown(1.2);
	const identite: [string, string][] = [
		['Dénomination', settings.emetteurNom],
		['Forme juridique', 'Association sans but lucratif (ASBL)'],
		['Siège', settings.emetteurAdresse.split('\n').map((l) => l.trim()).filter(Boolean).join(', ') || '—'],
		['Numéro d’entreprise', settings.emetteurNumeroEntreprise || '—'],
		['Exercice', `du 1er janvier ${journal.annee} au 31 décembre ${journal.annee}`],
		['Montants', 'en euros (EUR)']
	];
	for (const [k, v] of identite) {
		const y = doc.y;
		doc.font('Helvetica-Bold').fontSize(9.5).text(k, left, y, { width: 130 });
		doc.font('Helvetica').text(v, left + 135, y, { width: WIDTH - 135 });
	}

	// --- Statement of receipts and expenses ---------------------------------------------------
	titre('ÉTAT DES RECETTES ET DÉPENSES');
	const depenses: Cellule[] = RUBRIQUES_DEPENSES.map((r) => ({ label: RUBRIQUE_LABEL[r], montant: journal.depenses[r] }));
	const recettes: Cellule[] = RUBRIQUES_RECETTES.map((r) => ({ label: RUBRIQUE_LABEL[r], montant: journal.recettes[r] }));
	const totalDepenses = round(RUBRIQUES_DEPENSES.reduce((a, r) => a + journal.depenses[r], 0));
	const totalRecettes = round(RUBRIQUES_RECETTES.reduce((a, r) => a + journal.recettes[r], 0));
	depenses.push({ label: 'Total des dépenses', montant: totalDepenses, gras: true });
	recettes.push({ label: 'Total des recettes', montant: totalRecettes, gras: true });
	tableau({ titre: 'Dépenses', lignes: depenses }, { titre: 'Recettes', lignes: recettes });
	const resultat = round(totalRecettes - totalDepenses);
	doc.font('Helvetica-Bold').fontSize(9.5).text(`${resultat < 0 ? 'Déficit' : 'Excédent'} de l’exercice : ${eur(Math.abs(resultat))} EUR`, left, doc.y, { width: WIDTH, align: 'right' });

	// --- Annexe ------------------------------------------------------------------------------
	doc.addPage();
	doc.font('Helvetica-Bold').fontSize(13).text('ANNEXE', left, PAGE.margin, { width: WIDTH, align: 'center' });
	titre('1. Résumé des règles d’évaluation');
	paragraphe(comptes.reglesEvaluation);
	titre('2. Adaptation des règles d’évaluation');
	paragraphe(comptes.adaptationRegles);
	titre('3. Informations complémentaires');
	paragraphe(comptes.informationsComplementaires);

	const m = montantsPatrimoine(journal, comptes);
	titre(`4. État du patrimoine au 31 décembre ${journal.annee}`);
	const cellules = (lignes: typeof m.avoirs): Cellule[] =>
		lignes.map((l) => ({ label: l.label, montant: l.titre ? null : l.montant, indent: l.sousLigne }));
	tableau(
		{ titre: 'Avoirs', lignes: [...cellules(m.avoirs), { label: 'Total des avoirs', montant: m.totalAvoirs, gras: true }] },
		{ titre: 'Dettes', lignes: [...cellules(m.dettes), { label: 'Total des dettes', montant: m.totalDettes, gras: true }] }
	);

	titre('5. Droits et engagements importants qui ne sont pas susceptibles d’être quantifiés');
	paragraphe(comptes.droitsEngagementsTexte);
	doc.moveDown(0.8);
	tableau({ titre: 'Droits', lignes: cellules(m.droits) }, { titre: 'Engagements', lignes: cellules(m.engagements) });

	// --- Approval ----------------------------------------------------------------------------
	ensure(60);
	doc.moveDown(0.8).font('Helvetica').fontSize(9.5);
	doc.text(
		comptes.approuvesLe
			? `Comptes approuvés par l’assemblée générale du ${dateFormat.format(comptes.approuvesLe)}.`
			: 'Comptes approuvés par l’assemblée générale du ………………………………',
		left,
		doc.y,
		{ width: WIDTH }
	);
	doc.moveDown(1.5);
	const y = doc.y;
	doc.text('Nom, qualité et signature', left, y, { width: colWidth - 20 });
	doc.text('Nom, qualité et signature', left + colWidth + 20, y, { width: colWidth - 20 });

	doc.end();
	return done;
}
