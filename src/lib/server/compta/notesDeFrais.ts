import { getDb } from '$lib/server/db';
import { parseIsoDate, parseMoney, toIsoDate } from './dates';
import { tiersDisplayName, type TiersNature } from './tiers';

// Expense claims — docs/compta.md, "Notes de frais"; table in migration 24. A member submits one
// with its receipt; the treasury accepts or refuses; the refund is a bank movement allocated to
// the claim (banque.ts, cible note_de_frais), which marks it refunded.

export type NoteStatut = 'soumise' | 'acceptee' | 'refusee' | 'remboursee';

export interface NoteDeFrais {
	id: number;
	createdAt: Date;
	tiersId: number;
	tiersNom: string;
	tiersIban: string | null;
	date: Date;
	libelle: string;
	montant: number;
	statut: NoteStatut;
	hasJustificatif: boolean;
	justificatifNom: string | null;
	decisionLe: Date | null;
	decisionPar: string | null;
	motif: string | null;
	rembourseeLe: Date | null;
}

interface NoteRow {
	id: number;
	created_at: Date;
	tiers_id: number;
	tiers_nom: string;
	tiers_prenom: string | null;
	tiers_nature: TiersNature;
	tiers_iban: string | null;
	date: string;
	libelle: string;
	montant: string;
	statut: NoteStatut;
	has_justificatif: boolean;
	justificatif_nom: string | null;
	decision_le: Date | null;
	decision_par: string | null;
	motif: string | null;
	remboursee_le: string | null;
}

function rowToNote(r: NoteRow): NoteDeFrais {
	return {
		id: r.id,
		createdAt: r.created_at,
		tiersId: r.tiers_id,
		tiersNom: tiersDisplayName({ nature: r.tiers_nature, nom: r.tiers_nom, prenom: r.tiers_prenom }),
		tiersIban: r.tiers_iban,
		date: parseIsoDate(r.date),
		libelle: r.libelle,
		montant: parseMoney(r.montant),
		statut: r.statut,
		hasJustificatif: r.has_justificatif,
		justificatifNom: r.justificatif_nom,
		decisionLe: r.decision_le,
		decisionPar: r.decision_par,
		motif: r.motif,
		rembourseeLe: r.remboursee_le ? parseIsoDate(r.remboursee_le) : null
	};
}

// The receipt bytes are never selected in lists — only by readJustificatif().
const NOTE_SELECT = `
	SELECT n.id, n.created_at, n.tiers_id, t.nom AS tiers_nom, t.prenom AS tiers_prenom, t.nature AS tiers_nature,
	       t.iban AS tiers_iban, n.date::text AS date, n.libelle, n.montant, n.statut,
	       (n.justificatif IS NOT NULL) AS has_justificatif, n.justificatif_nom, n.decision_le, n.decision_par, n.motif,
	       n.remboursee_le::text AS remboursee_le
	FROM notes_de_frais n
	JOIN tiers t ON t.id = n.tiers_id
`;

export async function listNotesDeFrais(filter: { tiersId?: number; statut?: NoteStatut } = {}): Promise<NoteDeFrais[]> {
	const sql = await getDb();
	const rows = await sql<NoteRow[]>`
		${sql.unsafe(NOTE_SELECT)}
		WHERE ${filter.tiersId ? sql`n.tiers_id = ${filter.tiersId}` : sql`true`}
		  AND ${filter.statut ? sql`n.statut = ${filter.statut}` : sql`true`}
		ORDER BY (n.statut = 'soumise') DESC, n.date DESC, n.id DESC
	`;
	return rows.map(rowToNote);
}

export async function getNoteDeFrais(id: number): Promise<NoteDeFrais | null> {
	const sql = await getDb();
	const [row] = await sql<NoteRow[]>`${sql.unsafe(NOTE_SELECT)} WHERE n.id = ${id}`;
	return row ? rowToNote(row) : null;
}

export interface Justificatif {
	nom: string;
	type: string;
	bytes: Buffer;
}

export async function creerNoteDeFrais(input: {
	tiersId: number;
	date: Date;
	libelle: string;
	montant: number;
	justificatif: Justificatif | null;
}): Promise<NoteDeFrais> {
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO notes_de_frais (tiers_id, date, libelle, montant, justificatif, justificatif_nom, justificatif_type)
		VALUES (${input.tiersId}, ${toIsoDate(input.date)}, ${input.libelle.trim()}, ${input.montant},
		        ${input.justificatif?.bytes ?? null}, ${input.justificatif?.nom ?? null}, ${input.justificatif?.type ?? null})
		RETURNING id
	`;
	return (await getNoteDeFrais(row.id)) as NoteDeFrais;
}

export class NoteDeFraisError extends Error {}

// Accept or refuse a submitted claim. `par` is the treasurer's display name, kept on the row so
// the member sees who decided; the audit log has the full actor.
export async function deciderNoteDeFrais(id: number, decision: { acceptee: boolean; motif: string | null; par: string }): Promise<void> {
	if (!decision.acceptee && !decision.motif?.trim()) throw new NoteDeFraisError('Un refus doit être motivé.');
	const sql = await getDb();
	const result = await sql`
		UPDATE notes_de_frais
		SET statut = ${decision.acceptee ? 'acceptee' : 'refusee'}, decision_le = now(), decision_par = ${decision.par},
		    motif = ${decision.motif?.trim() || null}
		WHERE id = ${id} AND statut = 'soumise'
	`;
	if (result.count === 0) throw new NoteDeFraisError('Cette note a déjà été traitée.');
}

// A member may withdraw a claim while it's still waiting.
export async function retirerNoteDeFrais(id: number, tiersId: number): Promise<void> {
	const sql = await getDb();
	const result = await sql`DELETE FROM notes_de_frais WHERE id = ${id} AND tiers_id = ${tiersId} AND statut = 'soumise'`;
	if (result.count === 0) throw new NoteDeFraisError('Cette note ne peut plus être retirée.');
}

export async function readJustificatif(id: number): Promise<Justificatif | null> {
	const sql = await getDb();
	const [row] = await sql<{ justificatif: Buffer | null; justificatif_nom: string | null; justificatif_type: string | null }[]>`
		SELECT justificatif, justificatif_nom, justificatif_type FROM notes_de_frais WHERE id = ${id}
	`;
	if (!row?.justificatif) return null;
	return { bytes: row.justificatif, nom: row.justificatif_nom ?? `justificatif-${id}`, type: row.justificatif_type ?? 'application/octet-stream' };
}
