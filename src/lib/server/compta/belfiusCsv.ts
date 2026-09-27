import { createHash } from 'node:crypto';
import { normalizeIban } from '$lib/server/bankValidation';

// Reader for Belfius Direct Net's CSV export ("Exporter" on the account history). Pure: bytes in,
// movements out — nothing here touches the database, banque.ts does the inserting.
//
// The export is semicolon-separated, Windows-1252 or UTF-8 depending on the browser, with a
// header row such as:
//   Compte;Date de comptabilisation;N° d'extrait;N° de transaction;Compte contrepartie;
//   Nom contrepartie contient;Rue et numéro;Code postal et localité;Transaction;Date valeur;
//   Montant;Devise;BIC;Code pays;Communications
// sometimes preceded by a few preamble lines about the account. Columns are found by their
// headings (case- and accent-insensitive substrings), not by position, so a reordered or extended
// export still reads; dates are dd/mm/yyyy, amounts Belgian-formatted (1.234,56).

export interface MouvementImporte {
	dateValeur: Date;
	montant: number;
	libelle: string;
	contrepartieNom: string | null;
	contrepartieIban: string | null;
	communication: string | null;
	// Statement + transaction number when the export has them, else a hash of the row's content
	// — either way stable across re-exports of the same period.
	externalId: string;
}

export interface BelfiusParseResult {
	mouvements: MouvementImporte[];
	// Lines that couldn't be read, with why — shown to the treasurer, never silently dropped.
	erreurs: string[];
	// The account number the file says it belongs to, to check against the chosen compte.
	compte: string | null;
}

export class BelfiusCsvError extends Error {}

function decode(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

// Minimal CSV field splitter: semicolons, double-quoted fields with "" escapes.
function splitLine(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cur += c;
		} else if (c === '"') quoted = true;
		else if (c === ';') {
			out.push(cur);
			cur = '';
		} else cur += c;
	}
	out.push(cur);
	return out.map((f) => f.trim());
}

function fold(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase();
}

// Which heading means what. First match wins, so the more specific patterns come first.
const COLUMNS: { key: keyof RawColumns; patterns: string[] }[] = [
	{ key: 'compteContrepartie', patterns: ['compte contrepartie'] },
	{ key: 'nomContrepartie', patterns: ['nom contrepartie'] },
	{ key: 'compte', patterns: ['compte'] },
	{ key: 'dateValeur', patterns: ['date valeur'] },
	{ key: 'dateCompta', patterns: ['date de comptabilisation', 'date comptable', 'date'] },
	{ key: 'extrait', patterns: ["n° d'extrait", 'no d\'extrait', 'extrait'] },
	{ key: 'transaction', patterns: ['n° de transaction', 'no de transaction', 'numero de transaction'] },
	{ key: 'libelle', patterns: ['transaction', 'libelle', 'description'] },
	{ key: 'montant', patterns: ['montant'] },
	{ key: 'communication', patterns: ['communication'] }
];

interface RawColumns {
	compte?: number;
	dateCompta?: number;
	extrait?: number;
	transaction?: number;
	compteContrepartie?: number;
	nomContrepartie?: number;
	libelle?: number;
	dateValeur?: number;
	montant?: number;
	communication?: number;
}

function findHeader(lines: string[]): { index: number; columns: RawColumns } | null {
	for (let i = 0; i < Math.min(lines.length, 30); i++) {
		const cells = splitLine(lines[i]).map(fold);
		if (!cells.some((c) => c.includes('montant')) || !cells.some((c) => c.includes('date'))) continue;
		const columns: RawColumns = {};
		const taken = new Set<number>();
		for (const { key, patterns } of COLUMNS) {
			const idx = cells.findIndex((c, j) => !taken.has(j) && patterns.some((p) => c.includes(fold(p))));
			if (idx >= 0) {
				columns[key] = idx;
				taken.add(idx);
			}
		}
		if (columns.montant !== undefined && (columns.dateValeur !== undefined || columns.dateCompta !== undefined)) {
			return { index: i, columns };
		}
	}
	return null;
}

export function parseBelgianAmount(raw: string): number | null {
	const s = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
	if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
	return Number.parseFloat(s);
}

export function parseBelgianDate(raw: string): Date | null {
	const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw.trim());
	if (!m) return null;
	const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
	return date.getUTCDate() === Number(m[1]) ? date : null;
}

export function parseBelfiusCsv(bytes: Uint8Array): BelfiusParseResult {
	const text = decode(bytes).replace(/^﻿/, '');
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
	const header = findHeader(lines);
	if (!header) {
		throw new BelfiusCsvError("En-tête introuvable : le fichier ne ressemble pas à un export CSV Belfius (colonnes « Montant » et « Date valeur » attendues).");
	}
	const { columns } = header;
	const cell = (cells: string[], idx: number | undefined) => (idx === undefined ? '' : (cells[idx] ?? ''));

	const mouvements: MouvementImporte[] = [];
	const erreurs: string[] = [];
	let compte: string | null = null;

	for (let i = header.index + 1; i < lines.length; i++) {
		const cells = splitLine(lines[i]);
		const lineNo = i + 1;
		const montant = parseBelgianAmount(cell(cells, columns.montant));
		const dateValeur = parseBelgianDate(cell(cells, columns.dateValeur)) ?? parseBelgianDate(cell(cells, columns.dateCompta));
		if (montant === null || !dateValeur) {
			erreurs.push(`Ligne ${lineNo} : montant ou date illisible.`);
			continue;
		}
		if (!compte && columns.compte !== undefined) compte = normalizeIban(cell(cells, columns.compte)) || null;

		const extrait = cell(cells, columns.extrait);
		const transaction = cell(cells, columns.transaction);
		const libelle = cell(cells, columns.libelle) || cell(cells, columns.communication) || 'Mouvement';
		const contrepartieIban = normalizeIban(cell(cells, columns.compteContrepartie)) || null;
		const contrepartieNom = cell(cells, columns.nomContrepartie) || null;
		const communication = cell(cells, columns.communication) || null;

		const externalId =
			extrait && transaction
				? `${extrait}/${transaction}`
				: 'h:' +
					createHash('sha1')
						.update([dateValeur.toISOString(), montant, libelle, contrepartieIban ?? '', communication ?? ''].join('|'))
						.digest('hex')
						.slice(0, 20);

		mouvements.push({ dateValeur, montant, libelle, contrepartieNom, contrepartieIban, communication, externalId });
	}
	return { mouvements, erreurs, compte };
}
