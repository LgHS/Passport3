import type postgres from 'postgres';
import { getDb } from '$lib/server/db';
import { addUTCDays, brusselsToday, parseIsoDate, parseMoney, toIsoDate } from './dates';
import { renderFacturePdf } from './facturePdf';
import { renderUbl } from './ubl';
import { getComptaSettings, type ComptaSettings } from './settings';
import { getTiers, tiersDisplayName, type Tiers, type TiersNature } from './tiers';

// Issued and received invoices — model in docs/compta.md, "Factures"; tables in migration 11.
//
// Lifecycle of an issued invoice: brouillon (editable) → validee (numbered, PDF frozen, cotisation
// created as attendue) → payee (cotisation active). A brouillon can be annulee; a validated one can
// only be undone by a note de crédit, which on validation marks the original annulee.
// A received invoice is registered already validee (it's the supplier's document), then payee.

export type FactureSens = 'emise' | 'recue';
export type FactureType = 'facture' | 'note_de_credit';
export type FactureStatut = 'brouillon' | 'validee' | 'payee' | 'annulee';
export type FactureCotisationType = 'facturee' | 'sponsoring';

export interface FactureLigne {
	id: number;
	ordre: number;
	libelle: string;
	quantite: number;
	prixUnitaire: number;
	total: number;
}

export interface FactureCotisation {
	type: FactureCotisationType;
	debut: Date;
	fin: Date; // exclusive, like cotisations.fin
	sieges: number;
}

export interface Facture {
	id: number;
	createdAt: Date;
	sens: FactureSens;
	type: FactureType;
	tiersId: number;
	tiers: { id: number; nom: string; nature: TiersNature };
	numero: string | null;
	statut: FactureStatut;
	dateEmission: Date | null;
	dateEcheance: Date | null;
	total: number;
	objet: string | null;
	note: string | null;
	communicationStructuree: string | null;
	factureOrigineId: number | null;
	factureOrigineNumero: string | null;
	referenceExterne: string | null;
	// Whether the documents exist — the bytes themselves are only read by readFacturePdf().
	hasPdf: boolean;
	hasUbl: boolean;
	payeeLe: Date | null;
	// Last email of the document (factureMail.ts): when, and to whom (comma-separated).
	envoyeeLe: Date | null;
	envoyeeA: string | null;
	cotisation: FactureCotisation | null;
	cotisationId: number | null;
	lignes: FactureLigne[];
}

export interface LigneInput {
	libelle: string;
	quantite: number;
	prixUnitaire: number;
}

export interface FactureInput {
	sens: FactureSens;
	tiersId: number;
	dateEmission: Date | null;
	dateEcheance: Date | null;
	objet: string | null;
	note: string | null;
	// Received invoices carry the supplier's number; issued ones get theirs at validation.
	numero: string | null;
	lignes: LigneInput[];
	cotisation: FactureCotisation | null;
}

interface FactureRow {
	id: number;
	created_at: Date;
	sens: FactureSens;
	type: FactureType;
	tiers_id: number;
	tiers_nom: string;
	tiers_prenom: string | null;
	tiers_nature: TiersNature;
	numero: string | null;
	statut: FactureStatut;
	date_emission: string | null;
	date_echeance: string | null;
	total: string;
	objet: string | null;
	note: string | null;
	communication_structuree: string | null;
	facture_origine_id: number | null;
	facture_origine_numero: string | null;
	reference_externe: string | null;
	has_pdf: boolean;
	has_ubl: boolean;
	payee_le: string | null;
	envoyee_le: Date | null;
	envoyee_a: string | null;
	cotisation_type: FactureCotisationType | null;
	cotisation_debut: string | null;
	cotisation_fin: string | null;
	cotisation_sieges: number | null;
	cotisation_id: number | null;
}

interface LigneRow {
	id: number;
	facture_id: number;
	ordre: number;
	libelle: string;
	quantite: string;
	prix_unitaire: string;
	total: string;
}

// DATE columns as text (see dates.ts); the tiers' name joined in for lists; the note de crédit's
// original number for display; the cotisation the invoice created, if any.
const FACTURE_SELECT = `
	SELECT f.id, f.created_at, f.sens, f.type, f.tiers_id, t.nom AS tiers_nom, t.prenom AS tiers_prenom,
	       t.nature AS tiers_nature, f.numero, f.statut, f.date_emission::text AS date_emission,
	       f.date_echeance::text AS date_echeance, f.total, f.objet, f.note, f.communication_structuree,
	       f.facture_origine_id, o.numero AS facture_origine_numero, f.reference_externe,
	       (f.pdf IS NOT NULL) AS has_pdf, (f.ubl IS NOT NULL) AS has_ubl,
	       f.payee_le::text AS payee_le, f.envoyee_le, f.envoyee_a, f.cotisation_type, f.cotisation_debut::text AS cotisation_debut,
	       f.cotisation_fin::text AS cotisation_fin, f.cotisation_sieges,
	       (SELECT c.id FROM cotisations c WHERE c.facture_id = f.id ORDER BY c.id LIMIT 1) AS cotisation_id
	FROM factures f
	JOIN tiers t ON t.id = f.tiers_id
	LEFT JOIN factures o ON o.id = f.facture_origine_id
`;

function rowToFacture(r: FactureRow, lignes: LigneRow[]): Facture {
	return {
		id: r.id,
		createdAt: r.created_at,
		sens: r.sens,
		type: r.type,
		tiersId: r.tiers_id,
		tiers: {
			id: r.tiers_id,
			nom: tiersDisplayName({ nature: r.tiers_nature, nom: r.tiers_nom, prenom: r.tiers_prenom }),
			nature: r.tiers_nature
		},
		numero: r.numero,
		statut: r.statut,
		dateEmission: r.date_emission ? parseIsoDate(r.date_emission) : null,
		dateEcheance: r.date_echeance ? parseIsoDate(r.date_echeance) : null,
		total: parseMoney(r.total),
		objet: r.objet,
		note: r.note,
		communicationStructuree: r.communication_structuree,
		factureOrigineId: r.facture_origine_id,
		factureOrigineNumero: r.facture_origine_numero,
		referenceExterne: r.reference_externe,
		hasPdf: r.has_pdf,
		hasUbl: r.has_ubl,
		payeeLe: r.payee_le ? parseIsoDate(r.payee_le) : null,
		envoyeeLe: r.envoyee_le,
		envoyeeA: r.envoyee_a,
		cotisation:
			r.cotisation_type && r.cotisation_debut && r.cotisation_fin
				? {
						type: r.cotisation_type,
						debut: parseIsoDate(r.cotisation_debut),
						fin: parseIsoDate(r.cotisation_fin),
						sieges: r.cotisation_sieges ?? 1
					}
				: null,
		cotisationId: r.cotisation_id,
		lignes: lignes
			.filter((l) => l.facture_id === r.id)
			.sort((a, b) => a.ordre - b.ordre)
			.map((l) => ({
				id: l.id,
				ordre: l.ordre,
				libelle: l.libelle,
				quantite: parseMoney(l.quantite),
				prixUnitaire: parseMoney(l.prix_unitaire),
				total: parseMoney(l.total)
			}))
	};
}

async function loadLignes(sql: postgres.Sql | postgres.TransactionSql, factureIds: number[]): Promise<LigneRow[]> {
	if (factureIds.length === 0) return [];
	return sql<LigneRow[]>`SELECT * FROM facture_lignes WHERE facture_id = ANY(${factureIds}) ORDER BY facture_id, ordre`;
}

export interface FactureFilter {
	sens?: FactureSens;
	statut?: FactureStatut;
	tiersId?: number;
	// Several tiers at once — the member page's "mine and my organisations'".
	tiersIds?: number[];
}

export async function listFactures(filter: FactureFilter = {}): Promise<Facture[]> {
	const sql = await getDb();
	const rows = await sql<FactureRow[]>`
		${sql.unsafe(FACTURE_SELECT)}
		WHERE ${filter.sens ? sql`f.sens = ${filter.sens}` : sql`true`}
		  AND ${filter.statut ? sql`f.statut = ${filter.statut}` : sql`true`}
		  AND ${filter.tiersId ? sql`f.tiers_id = ${filter.tiersId}` : sql`true`}
		  AND ${filter.tiersIds ? sql`f.tiers_id = ANY(${filter.tiersIds})` : sql`true`}
		ORDER BY f.date_emission DESC NULLS FIRST, f.id DESC
	`;
	const lignes = await loadLignes(
		sql,
		rows.map((r) => r.id)
	);
	return rows.map((r) => rowToFacture(r, lignes));
}

export async function getFacture(id: number): Promise<Facture | null> {
	const sql = await getDb();
	const [row] = await sql<FactureRow[]>`${sql.unsafe(FACTURE_SELECT)} WHERE f.id = ${id}`;
	if (!row) return null;
	return rowToFacture(row, await loadLignes(sql, [row.id]));
}

// Money arithmetic in cents to keep 0.1 + 0.2 out of the books.
function lineTotal(l: LigneInput): number {
	return Math.round(l.quantite * l.prixUnitaire * 100) / 100;
}
function sumTotals(lignes: LigneInput[]): number {
	return lignes.reduce((acc, l) => acc + Math.round(lineTotal(l) * 100), 0) / 100;
}

async function writeLignes(tx: postgres.TransactionSql, factureId: number, lignes: LigneInput[]): Promise<void> {
	await tx`DELETE FROM facture_lignes WHERE facture_id = ${factureId}`;
	for (const [i, l] of lignes.entries()) {
		await tx`
			INSERT INTO facture_lignes (facture_id, ordre, libelle, quantite, prix_unitaire, total)
			VALUES (${factureId}, ${i + 1}, ${l.libelle.trim()}, ${l.quantite}, ${l.prixUnitaire}, ${lineTotal(l)})
		`;
	}
}

export class FactureError extends Error {}

export async function createFacture(input: FactureInput, type: FactureType = 'facture', origineId: number | null = null): Promise<Facture> {
	if (input.lignes.length === 0) throw new FactureError('Une facture doit avoir au moins une ligne.');
	const sql = await getDb();
	// A received invoice is the supplier's document: no draft stage, it's validated on entry and
	// keeps the supplier's number.
	const recue = input.sens === 'recue';
	if (recue && !input.numero?.trim()) throw new FactureError('Le numéro de la facture du fournisseur est obligatoire.');
	if (recue && !input.dateEmission) throw new FactureError('La date de la facture est obligatoire.');

	const id = await sql.begin(async (tx) => {
		const [row] = await tx<{ id: number }[]>`
			INSERT INTO factures (
				sens, type, tiers_id, numero, statut, date_emission, date_echeance, total, objet, note,
				facture_origine_id, cotisation_type, cotisation_debut, cotisation_fin, cotisation_sieges
			) VALUES (
				${input.sens}, ${type}, ${input.tiersId}, ${recue ? input.numero!.trim() : null},
				${recue ? 'validee' : 'brouillon'},
				${input.dateEmission ? toIsoDate(input.dateEmission) : null},
				${input.dateEcheance ? toIsoDate(input.dateEcheance) : null},
				${sumTotals(input.lignes)}, ${input.objet}, ${input.note}, ${origineId},
				${input.cotisation?.type ?? null},
				${input.cotisation ? toIsoDate(input.cotisation.debut) : null},
				${input.cotisation ? toIsoDate(input.cotisation.fin) : null},
				${input.cotisation?.sieges ?? null}
			)
			RETURNING id
		`;
		await writeLignes(tx, row.id, input.lignes);
		if (recue) {
			await tx`UPDATE tiers SET est_fournisseur = true, updated_at = now() WHERE id = ${input.tiersId}`;
		}
		return row.id;
	});
	return (await getFacture(id)) as Facture;
}

// Only a brouillon changes; everything after validation is frozen (see the module comment).
export async function updateFacture(id: number, input: FactureInput): Promise<Facture> {
	if (input.lignes.length === 0) throw new FactureError('Une facture doit avoir au moins une ligne.');
	const sql = await getDb();
	await sql.begin(async (tx) => {
		const [current] = await tx<{ statut: FactureStatut; sens: FactureSens }[]>`
			SELECT statut, sens FROM factures WHERE id = ${id} FOR UPDATE
		`;
		if (!current) throw new FactureError('Facture introuvable.');
		if (current.statut !== 'brouillon') throw new FactureError('Seul un brouillon peut être modifié.');
		await tx`
			UPDATE factures SET
				tiers_id = ${input.tiersId}, date_emission = ${input.dateEmission ? toIsoDate(input.dateEmission) : null},
				date_echeance = ${input.dateEcheance ? toIsoDate(input.dateEcheance) : null}, total = ${sumTotals(input.lignes)},
				objet = ${input.objet}, note = ${input.note},
				cotisation_type = ${input.cotisation?.type ?? null},
				cotisation_debut = ${input.cotisation ? toIsoDate(input.cotisation.debut) : null},
				cotisation_fin = ${input.cotisation ? toIsoDate(input.cotisation.fin) : null},
				cotisation_sieges = ${input.cotisation?.sieges ?? null},
				updated_at = now()
			WHERE id = ${id}
		`;
		await writeLignes(tx, id, input.lignes);
	});
	return (await getFacture(id)) as Facture;
}

// ---------------------------------------------------------------------------------------------
// Numbering and structured communication

// Distinct from the migrations' lock id (727300001); same reasoning about collisions there.
const NUMBERING_LOCK_ID = 727300002;

// AAAA-NNNN, gapless per year: the sequence row is bumped under an advisory lock so two
// validations in flight can't draw the same number, and only inside the validating transaction —
// a rollback gives the number back because the bump rolls back with it.
async function nextNumero(tx: postgres.TransactionSql, dateEmission: Date): Promise<string> {
	await tx`SELECT pg_advisory_xact_lock(${NUMBERING_LOCK_ID})`;
	const annee = dateEmission.getUTCFullYear();
	const [row] = await tx<{ dernier: number }[]>`
		INSERT INTO facture_sequences (annee, dernier) VALUES (${annee}, 1)
		ON CONFLICT (annee) DO UPDATE SET dernier = facture_sequences.dernier + 1
		RETURNING dernier
	`;
	return `${annee}-${String(row.dernier).padStart(4, '0')}`;
}

// Belgian structured communication (OGM/VCS): 10 digits of payload + 2 check digits (payload mod
// 97, with 0 written as 97), printed +++NNN/NNNN/NNNNN+++. The payload is the year and the
// sequence number, so the number is recoverable from a bank line at import time (phase 3).
export function communicationStructuree(numero: string): string {
	const [annee, seq] = numero.split('-');
	const payload = `${annee}${seq.padStart(6, '0')}`;
	const mod = Number(BigInt(payload) % 97n);
	const digits = payload + String(mod === 0 ? 97 : mod).padStart(2, '0');
	return `+++${digits.slice(0, 3)}/${digits.slice(3, 7)}/${digits.slice(7)}+++`;
}

// ---------------------------------------------------------------------------------------------
// Documents (stored in the row, see migration 11)

export async function readFacturePdf(id: number): Promise<Buffer | null> {
	const sql = await getDb();
	const [row] = await sql<{ pdf: Buffer | null }[]>`SELECT pdf FROM factures WHERE id = ${id}`;
	return row?.pdf ?? null;
}

export async function readFactureUbl(id: number): Promise<Buffer | null> {
	const sql = await getDb();
	const [row] = await sql<{ ubl: Buffer | null }[]>`SELECT ubl FROM factures WHERE id = ${id}`;
	return row?.ubl ?? null;
}

// A supplier's UBL, kept as received next to the row it produced (see /compta/factures/nouvelle).
export async function attachUbl(id: number, xml: Buffer): Promise<void> {
	const sql = await getDb();
	await sql`UPDATE factures SET ubl = ${xml}, updated_at = now() WHERE id = ${id}`;
}

export async function marquerEnvoyee(id: number, to: string[]): Promise<void> {
	const sql = await getDb();
	await sql`UPDATE factures SET envoyee_le = now(), envoyee_a = ${to.join(', ')}, updated_at = now() WHERE id = ${id}`;
}

// Attaches a document a human or the import supplies (a received invoice's PDF, an archived
// one). An issued invoice's own PDF is written by validerFacture() and never replaced.
export async function attachPdf(id: number, bytes: Buffer): Promise<void> {
	const sql = await getDb();
	await sql`UPDATE factures SET pdf = ${bytes}, updated_at = now() WHERE id = ${id}`;
}

// ---------------------------------------------------------------------------------------------
// Validation, payment, credit note

// Numbers the draft, renders and stores its PDF, creates the cotisation it announces (attendue),
// and freezes it — all in one transaction, so a render failure gives the number back and a
// validated invoice never exists without its PDF.
export async function validerFacture(id: number, today: Date = brusselsToday()): Promise<Facture> {
	const sql = await getDb();
	const settings = await getComptaSettings();
	await sql.begin(async (tx) => {
		const [current] = await tx<{ statut: FactureStatut; sens: FactureSens; date_emission: string | null }[]>`
			SELECT statut, sens, date_emission::text AS date_emission FROM factures WHERE id = ${id} FOR UPDATE
		`;
		if (!current) throw new FactureError('Facture introuvable.');
		if (current.sens !== 'emise') throw new FactureError('Une facture reçue n’a pas à être validée.');
		if (current.statut !== 'brouillon') throw new FactureError('Seul un brouillon peut être validé.');

		// An invoice is dated the day it's validated unless the draft said otherwise (e.g. a
		// subscription invoice dated at its period start).
		const dateEmission = current.date_emission ? parseIsoDate(current.date_emission) : today;
		const numero = await nextNumero(tx, dateEmission);
		const communication = communicationStructuree(numero);
		await tx`
			UPDATE factures SET
				numero = ${numero}, statut = 'validee', date_emission = ${toIsoDate(dateEmission)},
				date_echeance = COALESCE(date_echeance, ${toIsoDate(addUTCDays(dateEmission, settings.delaiPaiementJours))}),
				communication_structuree = ${communication}, updated_at = now()
			WHERE id = ${id}
		`;

		const [row] = await tx<FactureRow[]>`${tx.unsafe(FACTURE_SELECT)} WHERE f.id = ${id}`;
		const facture = rowToFacture(row, await loadLignes(tx, [id]));
		const tiers = await getTiers(facture.tiersId);
		if (!tiers) throw new FactureError('Tiers introuvable.');

		if (facture.cotisation) {
			await tx`
				INSERT INTO cotisations (tiers_id, type, debut, fin, montant, sieges, statut, facture_id, note)
				VALUES (${facture.tiersId}, ${facture.cotisation.type}, ${toIsoDate(facture.cotisation.debut)},
				        ${toIsoDate(facture.cotisation.fin)}, ${facture.total}, ${facture.cotisation.sieges}, 'attendue',
				        ${id}, ${`Facture ${numero}`})
			`;
		}
		if (facture.type === 'note_de_credit' && facture.factureOrigineId) {
			// The original is cancelled by the credit note — and so is the dues it announced.
			await tx`UPDATE factures SET statut = 'annulee', updated_at = now() WHERE id = ${facture.factureOrigineId}`;
			await tx`UPDATE cotisations SET statut = 'annulee' WHERE facture_id = ${facture.factureOrigineId}`;
		}
		await tx`UPDATE tiers SET est_client = true, updated_at = now() WHERE id = ${facture.tiersId} AND NOT est_client`;

		// Both documents are produced from the same frozen row: the UBL is what the customer's
		// e-invoicing platform reads, the PDF what a human reads.
		const pdf = await renderFacturePdf(facture, tiers, settings);
		const ubl = Buffer.from(renderUbl(facture, tiers, settings), 'utf8');
		await tx`UPDATE factures SET pdf = ${pdf}, ubl = ${ubl} WHERE id = ${id}`;
	});
	return (await getFacture(id)) as Facture;
}

// Manual for now; phase 3's bank matching will call the same thing.
export async function marquerPayee(id: number, payeeLe: Date = brusselsToday()): Promise<Facture> {
	const sql = await getDb();
	await sql.begin(async (tx) => {
		const [current] = await tx<{ statut: FactureStatut }[]>`SELECT statut FROM factures WHERE id = ${id} FOR UPDATE`;
		if (!current) throw new FactureError('Facture introuvable.');
		if (current.statut !== 'validee') throw new FactureError('Seule une facture validée peut être marquée payée.');
		await tx`UPDATE factures SET statut = 'payee', payee_le = ${toIsoDate(payeeLe)}, updated_at = now() WHERE id = ${id}`;
		await tx`
			UPDATE cotisations SET statut = 'active', paye_le = ${toIsoDate(payeeLe)}
			WHERE facture_id = ${id} AND statut = 'attendue'
		`;
	});
	return (await getFacture(id)) as Facture;
}

// Only a draft can simply be cancelled; a validated invoice needs a note de crédit.
export async function annulerBrouillon(id: number): Promise<void> {
	const sql = await getDb();
	const result = await sql`UPDATE factures SET statut = 'annulee', updated_at = now() WHERE id = ${id} AND statut = 'brouillon'`;
	if (result.count === 0) throw new FactureError('Seul un brouillon peut être annulé.');
}

// A draft note de crédit mirroring the original with negated lines; validating it (above) is what
// cancels the original.
export async function creerNoteDeCredit(origineId: number): Promise<Facture> {
	const origine = await getFacture(origineId);
	if (!origine || origine.sens !== 'emise') throw new FactureError('Facture introuvable.');
	if (origine.statut !== 'validee' && origine.statut !== 'payee') {
		throw new FactureError('Une note de crédit ne s’applique qu’à une facture validée.');
	}
	if (origine.type === 'note_de_credit') throw new FactureError('Une note de crédit ne se crédite pas.');
	return createFacture(
		{
			sens: 'emise',
			tiersId: origine.tiersId,
			dateEmission: null,
			dateEcheance: null,
			objet: `Note de crédit sur la facture ${origine.numero}`,
			note: null,
			numero: null,
			lignes: origine.lignes.map((l) => ({ libelle: l.libelle, quantite: l.quantite, prixUnitaire: -l.prixUnitaire })),
			cotisation: null
		},
		'note_de_credit',
		origine.id
	);
}

// Re-exported for callers that only need the issuer block (e.g. the parameters page preview).
export type { ComptaSettings };
