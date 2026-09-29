import { getDb } from '$lib/server/db';
import { getComptaSettings } from './settings';
import { getAttachment, getMessage, GmailError, listMessageIds, type GmailMessage } from './gmail';
import { isMailConfigured } from './mailer';
import {
	apparierPieces,
	headerValue,
	listerPiecesJointes,
	verifierExpediteur,
	type PieceJointe,
	type Verification
} from './receptionVerification';
import { enregistrerFactureUbl, factureRecueExistante, tiersPourFournisseur, trouverFournisseur } from './fournisseurs';
import { attachPdf, createFacture, FactureError, type Facture, type FactureInput } from './factures';
import { parseUbl, UblError, type UblLu } from './ubl';
import { parseIsoDate, parseMoney } from './dates';
import { lienPassport, notifierCompta } from './comptaNotifications';

// Supplier invoices arriving by email — docs/compta.md, "Réception". Doccle emails each invoice
// to the treasury's mailbox with its PDF and its UBL; this collects those mails (read-only, see
// gmail.ts), checks where each really comes from, and keeps the documents in documents_recus
// until a treasurer imports or discards them. Nothing reaches the books by itself.

export class ReceptionError extends Error {}

// 10 MB per attachment, like the manual upload.
const MAX_PIECE_BYTES = 10 * 1024 * 1024;
// How far back a collection looks. Mails already collected are skipped, so this only bounds the
// very first run and what a long interruption can catch up on.
const FENETRE = '1y';

export type DocumentStatut = 'a_traiter' | 'importe' | 'ignore';

export interface DocumentRecu {
	id: number;
	createdAt: Date;
	gmailMessageId: string;
	position: number;
	statut: DocumentStatut;
	pdfNom: string | null;
	ublNom: string | null;
	fournisseurNom: string | null;
	numero: string | null;
	dateEmission: Date | null;
	total: number | null;
	factureId: number | null;
	traiteLe: Date | null;
	traitePar: string | null;
	// From the mail the document came in.
	recuLe: Date;
	expediteur: string;
	sujet: string;
	verifie: boolean;
	verification: Verification & { ecartes?: string[] };
}

interface DocumentRow {
	id: number;
	created_at: Date;
	gmail_message_id: string;
	position: number;
	statut: DocumentStatut;
	pdf_nom: string | null;
	ubl_nom: string | null;
	fournisseur_nom: string | null;
	numero: string | null;
	date_emission: string | null;
	total: string | null;
	facture_id: number | null;
	traite_le: Date | null;
	traite_par: string | null;
	recu_le: Date;
	expediteur: string;
	sujet: string;
	verifie: boolean;
	verification: Verification & { ecartes?: string[] };
}

function toDocument(r: DocumentRow): DocumentRecu {
	return {
		id: r.id,
		createdAt: r.created_at,
		gmailMessageId: r.gmail_message_id,
		position: r.position,
		statut: r.statut,
		pdfNom: r.pdf_nom,
		ublNom: r.ubl_nom,
		fournisseurNom: r.fournisseur_nom,
		numero: r.numero,
		dateEmission: r.date_emission ? parseIsoDate(r.date_emission) : null,
		total: r.total === null ? null : parseMoney(r.total),
		factureId: r.facture_id,
		traiteLe: r.traite_le,
		traitePar: r.traite_par,
		recuLe: r.recu_le,
		expediteur: r.expediteur,
		sujet: r.sujet,
		verifie: r.verifie,
		verification: r.verification
	};
}

// The files themselves (BYTEA) are never part of a listing — see readDocumentFichier.
const DOCUMENT_COLUMNS = `
	d.id, d.created_at, d.gmail_message_id, d.position, d.statut, d.pdf_nom, d.ubl_nom, d.fournisseur_nom, d.numero,
	d.date_emission::text AS date_emission, d.total, d.facture_id, d.traite_le, d.traite_par,
	m.recu_le, m.expediteur, m.sujet, m.verifie, m.verification
`;

export async function listDocumentsRecus(statut?: DocumentStatut): Promise<DocumentRecu[]> {
	const sql = await getDb();
	const rows = await sql<DocumentRow[]>`
		SELECT ${sql.unsafe(DOCUMENT_COLUMNS)}
		FROM documents_recus d JOIN messages_releves m ON m.gmail_message_id = d.gmail_message_id
		${statut ? sql`WHERE d.statut = ${statut}` : sql``}
		ORDER BY m.recu_le DESC, d.id DESC
		LIMIT 300
	`;
	return rows.map(toDocument);
}

export async function getDocumentRecu(id: number): Promise<DocumentRecu | null> {
	const sql = await getDb();
	const [row] = await sql<DocumentRow[]>`
		SELECT ${sql.unsafe(DOCUMENT_COLUMNS)}
		FROM documents_recus d JOIN messages_releves m ON m.gmail_message_id = d.gmail_message_id
		WHERE d.id = ${id}
	`;
	return row ? toDocument(row) : null;
}

export async function countDocumentsATraiter(): Promise<number> {
	const sql = await getDb();
	const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM documents_recus WHERE statut = 'a_traiter'`;
	return row.n;
}

export async function readDocumentFichier(id: number, type: 'pdf' | 'ubl'): Promise<{ nom: string; bytes: Buffer } | null> {
	const sql = await getDb();
	const [row] = await sql<{ nom: string | null; bytes: Buffer | null }[]>`
		SELECT ${type === 'pdf' ? sql`pdf_nom AS nom, pdf AS bytes` : sql`ubl_nom AS nom, ubl AS bytes`}
		FROM documents_recus WHERE id = ${id}
	`;
	return row?.bytes && row.nom ? { nom: row.nom, bytes: row.bytes } : null;
}

// ---------------------------------------------------------------------------------------------
// Collection

export interface Releve {
	// Mails seen for the first time in this run.
	messages: number;
	documents: number;
	nonVerifies: number;
	// Mails that couldn't be collected this time (they'll be tried again at the next run).
	erreurs: string[];
}

// The Gmail search that selects Doccle's mails: from one of the accepted domains, with an
// attachment. Only a pre-filter — what decides is verifierExpediteur, on the headers.
export function requeteGmail(domaines: string[]): string {
	return `has:attachment newer_than:${FENETRE} {${domaines.map((d) => `from:${d}`).join(' ')}}`;
}

export function domainesAcceptes(settingsValue: string): string[] {
	return settingsValue
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
}

async function telechargerPieces(message: GmailMessage, ecartes: string[]): Promise<PieceJointe[]> {
	const pieces: PieceJointe[] = [];
	for (const ref of listerPiecesJointes(message.payload)) {
		if (ref.taille > MAX_PIECE_BYTES) {
			ecartes.push(`${ref.nom} : trop volumineux (10 Mo max).`);
			continue;
		}
		const bytes = ref.data ? Buffer.from(ref.data, 'base64url') : await getAttachment(message.id, ref.attachmentId!);
		if (bytes.length > MAX_PIECE_BYTES) {
			ecartes.push(`${ref.nom} : trop volumineux (10 Mo max).`);
			continue;
		}
		pieces.push({ nom: ref.nom, type: ref.type, bytes });
	}
	return pieces;
}

// Collects one mail: its sender check and its documents, in one transaction so a mail is either
// fully collected or not at all. Returns null when it was already collected.
async function releverMessage(id: string, domaines: string[]): Promise<{ documents: number; verifie: boolean } | null> {
	const sql = await getDb();
	const [deja] = await sql`SELECT 1 FROM messages_releves WHERE gmail_message_id = ${id}`;
	if (deja) return null;

	const message = await getMessage(id);
	const headers = message.payload.headers ?? [];
	const verification = verifierExpediteur(headers, domaines);
	const ecartes: string[] = [];
	const { documents, ecartes: nonRetenus } = apparierPieces(await telechargerPieces(message, ecartes));
	ecartes.push(...nonRetenus);

	await sql.begin(async (tx) => {
		const inserted = await tx`
			INSERT INTO messages_releves (gmail_message_id, recu_le, expediteur, sujet, verifie, verification)
			VALUES (
				${id}, ${new Date(Number(message.internalDate))},
				${(headerValue(headers, 'From') ?? '').slice(0, 500)},
				${(headerValue(headers, 'Subject') ?? '').slice(0, 500)},
				${verification.verifie}, ${tx.json({ ...verification, ecartes } as never)}
			)
			ON CONFLICT (gmail_message_id) DO NOTHING
			RETURNING gmail_message_id
		`;
		// Another run collected it in the meantime.
		if (inserted.length === 0) return;
		for (const [position, doc] of documents.entries()) {
			await tx`
				INSERT INTO documents_recus (
					gmail_message_id, position, pdf, pdf_nom, ubl, ubl_nom, fournisseur_nom, numero, date_emission, total
				) VALUES (
					${id}, ${position}, ${doc.pdf?.bytes ?? null}, ${doc.pdf?.nom ?? null}, ${doc.ubl?.bytes ?? null},
					${doc.ubl?.nom ?? null}, ${doc.lu?.fournisseur.nom ?? null}, ${doc.lu?.numero ?? null},
					${doc.lu?.dateEmission ?? null}, ${doc.lu?.total ?? null}
				)
			`;
		}
	});
	return { documents: documents.length, verifie: verification.verifie };
}

// Arbitrary, fixed constant — see migrations.ts's MIGRATION_LOCK_ID. Two collections at once
// (the button and the hourly run) would only waste Gmail calls, but there's no reason to let them.
const RELEVE_LOCK_ID = 727300004;

export async function releverBoite(): Promise<Releve> {
	if (!(await isMailConfigured())) throw new ReceptionError('Aucune boîte Gmail connectée (Compta → Paramètres).');
	const settings = await getComptaSettings();
	const domaines = domainesAcceptes(settings.receptionDomaines);
	if (domaines.length === 0) throw new ReceptionError('Aucun domaine d’expéditeur accepté (Compta → Paramètres).');

	const sql = await getDb();
	const releve: Releve = { messages: 0, documents: 0, nonVerifies: 0, erreurs: [] };
	const reserved = await sql.reserve();
	try {
		const [{ locked }] = await reserved<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${RELEVE_LOCK_ID}) AS locked`;
		if (!locked) throw new ReceptionError('Un relevé est déjà en cours.');
		try {
			let ids: string[];
			try {
				ids = await listMessageIds(requeteGmail(domaines));
			} catch (err) {
				if (err instanceof GmailError) throw new ReceptionError(err.message, { cause: err });
				throw err;
			}
			// Oldest first, so documents appear in the order they arrived.
			for (const id of ids.reverse()) {
				try {
					const r = await releverMessage(id, domaines);
					if (!r) continue;
					releve.messages++;
					releve.documents += r.documents;
					if (!r.verifie && r.documents > 0) releve.nonVerifies++;
				} catch (err) {
					console.error(`[reception] message ${id} failed:`, err);
					releve.erreurs.push(err instanceof GmailError ? err.message : 'Un mail n’a pas pu être relevé.');
				}
			}
		} finally {
			await reserved`SELECT pg_advisory_unlock(${RELEVE_LOCK_ID})`;
		}
	} finally {
		reserved.release();
	}

	if (releve.documents > 0) {
		await notifierCompta(
			'reception',
			`📥 ${releve.documents} facture${releve.documents > 1 ? 's' : ''} reçue${releve.documents > 1 ? 's' : ''} par email, à valider` +
				(releve.nonVerifies > 0 ? ` — dont ${releve.nonVerifies} mail${releve.nonVerifies > 1 ? 's' : ''} d’origine non prouvée` : '') +
				` : ${lienPassport('/compta/reception', 'Réception Doccle')}`
		);
	}
	return releve;
}

// ---------------------------------------------------------------------------------------------
// Validation

export interface Apercu {
	lu: UblLu | null;
	// Why the UBL can't be read any more (it could when collected).
	erreur: string | null;
	// The tiers the supplier block designates, when the books know it.
	fournisseur: { id: number; nom: string } | null;
	// A received invoice with the same supplier and number already registered.
	doublonFactureId: number | null;
}

export async function apercuDocument(doc: DocumentRecu): Promise<Apercu> {
	const fichier = doc.ublNom ? await readDocumentFichier(doc.id, 'ubl') : null;
	if (!fichier) return { lu: null, erreur: null, fournisseur: null, doublonFactureId: null };
	let lu: UblLu;
	try {
		lu = parseUbl(fichier.bytes.toString('utf8'));
	} catch (err) {
		if (err instanceof UblError) return { lu: null, erreur: err.message, fournisseur: null, doublonFactureId: null };
		throw err;
	}
	const fournisseur = await trouverFournisseur(lu.fournisseur);
	return {
		lu,
		erreur: null,
		fournisseur,
		doublonFactureId: fournisseur ? await factureRecueExistante(fournisseur.id, lu.numero) : null
	};
}

export interface ImportOptions {
	actorLabel: string;
	// The treasurer's own choice of tiers, overriding the one the UBL designates.
	tiersId: number | null;
	// Required for a mail whose origin isn't proven: the treasurer checked it themselves.
	origineConfirmee: boolean;
	// Required when the same invoice is already registered.
	doublonAccepte: boolean;
	// For a PDF without UBL: the invoice as typed by the treasurer.
	saisie: FactureInput | null;
}

// Turns a collected document into a received invoice. Everything is re-checked here, not trusted
// from what the page showed: status, origin, duplicate.
export async function importerDocument(id: number, options: ImportOptions): Promise<Facture> {
	const doc = await getDocumentRecu(id);
	if (!doc) throw new ReceptionError('Document introuvable.');
	if (doc.statut === 'importe') throw new ReceptionError('Ce document est déjà importé.');
	if (!doc.verifie && !options.origineConfirmee) {
		throw new ReceptionError('L’origine de ce mail n’est pas prouvée : confirmez l’avoir vérifiée pour importer.');
	}

	const pdf = doc.pdfNom ? ((await readDocumentFichier(id, 'pdf'))?.bytes ?? null) : null;
	let facture: Facture;
	try {
		if (doc.ublNom) {
			const ubl = (await readDocumentFichier(id, 'ubl'))!.bytes;
			let lu: UblLu;
			try {
				lu = parseUbl(ubl.toString('utf8'));
			} catch (err) {
				if (err instanceof UblError) throw new ReceptionError(err.message);
				throw err;
			}
			const tiersId = options.tiersId ?? (await tiersPourFournisseur(lu.fournisseur, 'Créé depuis une facture reçue par email (Doccle).'));
			if (!options.doublonAccepte && (await factureRecueExistante(tiersId, lu.numero))) {
				throw new ReceptionError(`La facture ${lu.numero} de ce fournisseur est déjà enregistrée.`);
			}
			facture = await enregistrerFactureUbl(lu, tiersId, { ubl, pdf });
		} else {
			if (!options.saisie) throw new ReceptionError('Ce document n’a pas d’UBL : renseignez la facture.');
			if (!options.doublonAccepte && options.saisie.numero && (await factureRecueExistante(options.saisie.tiersId, options.saisie.numero))) {
				throw new ReceptionError(`La facture ${options.saisie.numero} de ce fournisseur est déjà enregistrée.`);
			}
			facture = await createFacture({ ...options.saisie, sens: 'recue', cotisation: null });
			if (pdf) await attachPdf(facture.id, pdf);
		}
	} catch (err) {
		if (err instanceof FactureError) throw new ReceptionError(err.message);
		throw err;
	}

	const sql = await getDb();
	await sql`
		UPDATE documents_recus
		SET statut = 'importe', facture_id = ${facture.id}, traite_le = now(), traite_par = ${options.actorLabel}
		WHERE id = ${id}
	`;
	return facture;
}

// Discarding keeps the document (and says who discarded it); it can be put back.
export async function changerStatutDocument(id: number, statut: 'a_traiter' | 'ignore', actorLabel: string): Promise<void> {
	const sql = await getDb();
	const rows = await sql`
		UPDATE documents_recus
		SET statut = ${statut}, traite_le = ${statut === 'ignore' ? sql`now()` : null}, traite_par = ${statut === 'ignore' ? actorLabel : null}
		WHERE id = ${id} AND statut <> 'importe'
		RETURNING id
	`;
	if (rows.length === 0) throw new ReceptionError('Document introuvable ou déjà importé.');
}

// ---------------------------------------------------------------------------------------------
// Hourly collection, when switched on in the settings

const RELEVE_INTERVAL_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
	try {
		const settings = await getComptaSettings();
		if (!settings.receptionAuto || !(await isMailConfigured())) return;
		const releve = await releverBoite();
		if (releve.messages > 0 || releve.erreurs.length > 0) {
			console.log(`[reception] ${releve.messages} mail(s), ${releve.documents} document(s), ${releve.erreurs.length} erreur(s)`);
		}
	} catch (err) {
		console.error('[reception] collection failed:', err);
	}
}

export function startReceptionScheduler(): void {
	if (timer) return;
	timer = setInterval(tick, RELEVE_INTERVAL_MS);
	timer.unref?.();
	// First run a few minutes after boot, not during it.
	setTimeout(tick, 5 * 60 * 1000).unref?.();
}
