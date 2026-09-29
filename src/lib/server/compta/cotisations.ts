import { getDb } from '$lib/server/db';
import type { AppUser, CotisationStatus } from '$lib/types';
import { addUTCDays, brusselsToday, parseIsoDate, parseMoney, toIsoDate } from './dates';
import { lienEnCours, listLiensOfPersonne } from './liens';
import { getComptaSettings } from './settings';
import { listTiers, resolveTiersForUser, tiersDisplayName, type Tiers } from './tiers';

// Cotisations, abonnements, and the membership status derived from them. Model in docs/compta.md
// ("Cotisations", "Droit de membre"); tables in migration 20.
//
// This module is what the member-facing pages (layout, homepage, /cotisation) call in place of the
// old dolibarr.ts: getSituationForUser() returns the same status/datefin/gaps/isInactive block they
// already render, computed from Postgres.

export type CotisationType = 'libre' | 'facturee' | 'sponsoring';
export type CotisationStatut = 'attendue' | 'active' | 'annulee';
export type Periodicite = 'mois' | 'annee';

export interface Cotisation {
	id: number;
	createdAt: Date;
	tiersId: number;
	type: CotisationType;
	// [debut, fin): `fin` is the first day not covered — see the migration's comment.
	debut: Date;
	fin: Date;
	montant: number;
	sieges: number;
	statut: CotisationStatut;
	abonnementId: number | null;
	factureId: number | null;
	payeLe: Date | null;
	note: string | null;
	dolibarrSubscriptionId: number | null;
}

export interface CotisationInput {
	tiersId: number;
	type: CotisationType;
	debut: Date;
	fin: Date;
	montant: number;
	sieges: number;
	statut: CotisationStatut;
	abonnementId: number | null;
	factureId: number | null;
	payeLe: Date | null;
	note: string | null;
}

interface CotisationRow {
	id: number;
	created_at: Date;
	tiers_id: number;
	type: CotisationType;
	debut: string;
	fin: string;
	montant: string;
	sieges: number;
	statut: CotisationStatut;
	abonnement_id: number | null;
	facture_id: number | null;
	paye_le: string | null;
	note: string | null;
	dolibarr_subscription_id: number | null;
}

function rowToCotisation(r: CotisationRow): Cotisation {
	return {
		id: r.id,
		createdAt: r.created_at,
		tiersId: r.tiers_id,
		type: r.type,
		debut: parseIsoDate(r.debut),
		fin: parseIsoDate(r.fin),
		montant: parseMoney(r.montant),
		sieges: r.sieges,
		statut: r.statut,
		abonnementId: r.abonnement_id,
		factureId: r.facture_id,
		payeLe: r.paye_le ? parseIsoDate(r.paye_le) : null,
		note: r.note,
		dolibarrSubscriptionId: r.dolibarr_subscription_id
	};
}

// DATE columns come back as text so parseIsoDate() pins them to UTC midnight itself.
const COTISATION_COLUMNS = `id, created_at, tiers_id, type, debut::text AS debut, fin::text AS fin, montant,
	sieges, statut, abonnement_id, facture_id, paye_le::text AS paye_le, note, dolibarr_subscription_id`;

export async function listCotisations(tiersId: number): Promise<Cotisation[]> {
	const sql = await getDb();
	const rows = await sql<CotisationRow[]>`
		SELECT ${sql.unsafe(COTISATION_COLUMNS)} FROM cotisations
		WHERE tiers_id = ${tiersId}
		ORDER BY debut DESC, id DESC
	`;
	return rows.map(rowToCotisation);
}

export async function getCotisation(id: number): Promise<Cotisation | null> {
	const sql = await getDb();
	const [row] = await sql<CotisationRow[]>`
		SELECT ${sql.unsafe(COTISATION_COLUMNS)} FROM cotisations WHERE id = ${id}
	`;
	return row ? rowToCotisation(row) : null;
}

export async function createCotisation(input: CotisationInput): Promise<Cotisation> {
	const sql = await getDb();
	const [row] = await sql<CotisationRow[]>`
		INSERT INTO cotisations (tiers_id, type, debut, fin, montant, sieges, statut, abonnement_id, facture_id, paye_le, note)
		VALUES (
			${input.tiersId}, ${input.type}, ${toIsoDate(input.debut)}, ${toIsoDate(input.fin)}, ${input.montant},
			${input.sieges}, ${input.statut}, ${input.abonnementId}, ${input.factureId},
			${input.payeLe ? toIsoDate(input.payeLe) : null}, ${input.note}
		)
		RETURNING ${sql.unsafe(COTISATION_COLUMNS)}
	`;
	return rowToCotisation(row);
}

export async function updateCotisation(id: number, input: CotisationInput): Promise<Cotisation | null> {
	const sql = await getDb();
	const [row] = await sql<CotisationRow[]>`
		UPDATE cotisations SET
			type = ${input.type}, debut = ${toIsoDate(input.debut)}, fin = ${toIsoDate(input.fin)},
			montant = ${input.montant}, sieges = ${input.sieges}, statut = ${input.statut},
			abonnement_id = ${input.abonnementId}, facture_id = ${input.factureId},
			paye_le = ${input.payeLe ? toIsoDate(input.payeLe) : null},
			note = ${input.note}
		WHERE id = ${id}
		RETURNING ${sql.unsafe(COTISATION_COLUMNS)}
	`;
	return row ? rowToCotisation(row) : null;
}

// ---------------------------------------------------------------------------------------------
// Abonnements (organisations' recurring dues contracts)

export interface Abonnement {
	id: number;
	tiersId: number;
	libelle: string;
	prix: number;
	periodicite: Periodicite;
	sieges: number;
	prochaineEcheance: Date;
	actif: boolean;
}

export interface AbonnementInput {
	tiersId: number;
	libelle: string;
	prix: number;
	periodicite: Periodicite;
	sieges: number;
	prochaineEcheance: Date;
	actif: boolean;
}

interface AbonnementRow {
	id: number;
	tiers_id: number;
	libelle: string;
	prix: string;
	periodicite: Periodicite;
	sieges: number;
	prochaine_echeance: string;
	actif: boolean;
}

function rowToAbonnement(r: AbonnementRow): Abonnement {
	return {
		id: r.id,
		tiersId: r.tiers_id,
		libelle: r.libelle,
		prix: parseMoney(r.prix),
		periodicite: r.periodicite,
		sieges: r.sieges,
		prochaineEcheance: parseIsoDate(r.prochaine_echeance),
		actif: r.actif
	};
}

const ABONNEMENT_COLUMNS = `id, tiers_id, libelle, prix, periodicite, sieges, prochaine_echeance::text AS prochaine_echeance, actif`;

export async function listAbonnements(tiersId: number): Promise<Abonnement[]> {
	const sql = await getDb();
	const rows = await sql<AbonnementRow[]>`
		SELECT ${sql.unsafe(ABONNEMENT_COLUMNS)} FROM abonnements WHERE tiers_id = ${tiersId} ORDER BY actif DESC, id
	`;
	return rows.map(rowToAbonnement);
}

export async function getAbonnement(id: number): Promise<Abonnement | null> {
	const sql = await getDb();
	const [row] = await sql<AbonnementRow[]>`
		SELECT ${sql.unsafe(ABONNEMENT_COLUMNS)} FROM abonnements WHERE id = ${id}
	`;
	return row ? rowToAbonnement(row) : null;
}

export async function createAbonnement(input: AbonnementInput): Promise<Abonnement> {
	const sql = await getDb();
	const [row] = await sql<AbonnementRow[]>`
		INSERT INTO abonnements (tiers_id, libelle, prix, periodicite, sieges, prochaine_echeance, actif)
		VALUES (${input.tiersId}, ${input.libelle.trim()}, ${input.prix}, ${input.periodicite}, ${input.sieges},
		        ${toIsoDate(input.prochaineEcheance)}, ${input.actif})
		RETURNING ${sql.unsafe(ABONNEMENT_COLUMNS)}
	`;
	return rowToAbonnement(row);
}

export async function updateAbonnement(id: number, input: AbonnementInput): Promise<Abonnement | null> {
	const sql = await getDb();
	const [row] = await sql<AbonnementRow[]>`
		UPDATE abonnements SET
			libelle = ${input.libelle.trim()}, prix = ${input.prix}, periodicite = ${input.periodicite},
			sieges = ${input.sieges}, prochaine_echeance = ${toIsoDate(input.prochaineEcheance)}, actif = ${input.actif}
		WHERE id = ${id}
		RETURNING ${sql.unsafe(ABONNEMENT_COLUMNS)}
	`;
	return row ? rowToAbonnement(row) : null;
}

// ---------------------------------------------------------------------------------------------
// Coverage, gaps and status

export interface Periode {
	debut: Date;
	fin: Date; // exclusive
}

// Merges overlapping or back-to-back periods into continuous coverage ranges. With exclusive ends,
// "back-to-back" is the exact equality `next.debut === last.fin` — no tolerance. A period fully
// inside the previous one (regularisation, duplicate) must not shorten the range, hence the max.
export function mergePeriodes(periodes: Periode[]): Periode[] {
	const sorted = [...periodes].sort((a, b) => a.debut.getTime() - b.debut.getTime());
	const merged: Periode[] = [];
	for (const p of sorted) {
		const last = merged[merged.length - 1];
		if (last && p.debut.getTime() <= last.fin.getTime()) {
			if (p.fin.getTime() > last.fin.getTime()) last.fin = p.fin;
		} else {
			merged.push({ debut: p.debut, fin: p.fin });
		}
	}
	return merged;
}

// A gap is a *calendar month* with no coverage, pinned to UTC midnight on the 1st and the last day
// — the same shape the old Dolibarr code produced and the /cotisation page already formats in UTC.
export interface CotisationGap {
	start: Date;
	end: Date;
}

// Past this many months of ongoing lapse the status alone ("expirée") carries the message; the
// "Non perçu" rows stop accumulating. Only a display cap — inactivity itself is decided by the
// grace period in compta_settings, not by this constant.
const TRAILING_GAP_MONTHS = 3;

// Splits an uncovered interval [prevFin, nextDebut) into one gap per calendar month. A month is
// missing when its 15th falls inside the interval: this encodes the LgHS convention that a
// cotisation running "end of M-1 → end of M" pays for month M, so a boundary sitting on the last
// day of a month doesn't flag the month it closes. Same criterion as before; the exclusive
// `prevFin` makes the lower comparison `>=` rather than `>`.
export function missingMonthsInGap(prevFin: Date, nextDebut: Date): CotisationGap[] {
	const months: CotisationGap[] = [];
	let cursor = new Date(Date.UTC(prevFin.getUTCFullYear(), prevFin.getUTCMonth(), 1));
	const lastMonth = new Date(Date.UTC(nextDebut.getUTCFullYear(), nextDebut.getUTCMonth(), 1));

	while (cursor.getTime() <= lastMonth.getTime()) {
		const year = cursor.getUTCFullYear();
		const month = cursor.getUTCMonth();
		const midpoint = new Date(Date.UTC(year, month, 15));
		if (midpoint.getTime() >= prevFin.getTime() && midpoint.getTime() < nextDebut.getTime()) {
			months.push({
				start: new Date(Date.UTC(year, month, 1)),
				end: new Date(Date.UTC(year, month + 1, 0))
			});
		}
		cursor = new Date(Date.UTC(year, month + 1, 1));
	}
	return months;
}

// Interior gaps in full (their extent is known and finite), plus the most recent TRAILING_GAP_MONTHS
// months of an ongoing lapse — cut from the end, so someone eight months gone sees the months just
// before today, not three stale ones followed by silence.
export function detectCotisationGaps(coverage: Periode[], today: Date): CotisationGap[] {
	const gaps: CotisationGap[] = [];
	for (let i = 1; i < coverage.length; i++) {
		gaps.push(...missingMonthsInGap(coverage[i - 1].fin, coverage[i].debut));
	}
	const last = coverage[coverage.length - 1];
	// `today >= last.fin`: coverage has ended (a future-running cotisation yields nothing).
	if (last && today.getTime() >= last.fin.getTime()) {
		// `today + 1` because the interval's upper bound is exclusive and today itself is uncovered.
		gaps.push(...missingMonthsInGap(last.fin, addUTCDays(today, 1)).slice(-TRAILING_GAP_MONTHS));
	}
	return gaps;
}

// One cotisation in a member's history, with where it came from — their own, or inherited through
// an organisation they're linked to.
export interface CotisationHistorique {
	id: number;
	// Inclusive last covered day, for display — what the old Dolibarr `datef` was.
	start: Date;
	end: Date;
	amount: number;
	type: CotisationType;
	statut: CotisationStatut;
	via: string | null;
}

export interface Situation {
	status: CotisationStatus;
	// Last covered day of the current or most recent coverage range (inclusive, for display).
	datefin: Date | null;
	// Last day access stays open after coverage ended — set only while en_grace.
	finGrace: Date | null;
	// Where the current coverage comes from: null for one's own cotisation, the organisation's
	// display name when inherited (see docs/compta.md, "Droit de membre").
	via: string | null;
	// Every active cotisation covering today, by source: null = the person's own, else the
	// organisation's name. More than one entry = covered twice over (own dues and a company's),
	// which the pages say explicitly rather than hiding one of the two.
	sourcesAujourdhui: (string | null)[];
	isInactive: boolean;
	gaps: CotisationGap[];
	subscriptions: CotisationHistorique[];
	delaiGraceJours: number;
}

function toHistorique(c: Cotisation, via: string | null): CotisationHistorique {
	return {
		id: c.id,
		start: c.debut,
		end: addUTCDays(c.fin, -1),
		amount: c.montant,
		type: c.type,
		statut: c.statut,
		via
	};
}

// An organisation's cotisations as seen from a linked person. A closed link stops conferring
// coverage from `jusqua` on, but the months it did cover stay in the history: each period is
// clipped to the link's own.
function inheritedHistorique(
	cotisations: Cotisation[],
	lien: { depuis: Date; jusqua: Date | null },
	via: string
): CotisationHistorique[] {
	const out: CotisationHistorique[] = [];
	for (const c of cotisations) {
		const debut = new Date(Math.max(c.debut.getTime(), lien.depuis.getTime()));
		const fin = lien.jusqua ? new Date(Math.min(c.fin.getTime(), lien.jusqua.getTime())) : c.fin;
		if (fin.getTime() <= debut.getTime()) continue;
		out.push(toHistorique({ ...c, debut, fin }, via));
	}
	return out;
}

function sortHistorique(history: CotisationHistorique[]): CotisationHistorique[] {
	return history.sort((a, b) => b.start.getTime() - a.start.getTime());
}

// Own cotisations plus, for a person, those of the organisations covering them through an open
// `herite_adhesion` link. An organisation's status is computed from its own cotisations only.
async function collectCotisations(tiers: Tiers): Promise<CotisationHistorique[]> {
	const own = (await listCotisations(tiers.id)).map((c) => toHistorique(c, null));
	if (tiers.nature !== 'personne_physique') return own;

	const inherited: CotisationHistorique[] = [];
	for (const lien of await listLiensOfPersonne(tiers.id)) {
		if (!lien.heriteAdhesion) continue;
		inherited.push(
			...inheritedHistorique(await listCotisations(lien.organisationId), lien, tiersDisplayName(lien.organisation))
		);
	}
	return sortHistorique([...own, ...inherited]);
}

// Pure: the whole status derivation, given everything already loaded — so it can be unit-tested
// and reused by the bulk listing below without a query per member.
export function computeSituation(
	tiers: Pick<Tiers, 'exempteCotisation'>,
	history: CotisationHistorique[],
	delaiGraceJours: number,
	today: Date
): Situation {
	// Only paid (active) cotisations grant coverage — an invoiced-but-unpaid one shows in the
	// history as `attendue` and is what the grace period bridges.
	const active = history.filter((h) => h.statut === 'active');
	const coverage = mergePeriodes(active.map((h) => ({ debut: h.start, fin: addUTCDays(h.end, 1) })));
	const gaps = detectCotisationGaps(coverage, today);

	const base = { gaps, subscriptions: history, delaiGraceJours, isInactive: false, finGrace: null, via: null, sourcesAujourdhui: [] as (string | null)[] };

	if (tiers.exempteCotisation) {
		return { ...base, status: 'non_applicable', datefin: null };
	}
	if (coverage.length === 0) {
		return { ...base, status: 'en_attente', datefin: null };
	}

	const current = coverage.find((p) => p.debut.getTime() <= today.getTime() && today.getTime() < p.fin.getTime());
	if (current) {
		// Who is paying for today: the active cotisation whose period contains today, preferring
		// the member's own over an inherited one when both do.
		const couvrant = active
			.filter((h) => h.start.getTime() <= today.getTime() && today.getTime() <= h.end.getTime())
			.sort((a, b) => Number(a.via !== null) - Number(b.via !== null));
		const sourcesAujourdhui = [...new Set(couvrant.map((h) => h.via))];
		return { ...base, status: 'a_jour', datefin: addUTCDays(current.fin, -1), via: couvrant[0]?.via ?? null, sourcesAujourdhui };
	}

	// Not covered today. A future-only coverage (paid in advance for a period starting later) is
	// rare; it reads as "en attente" until it starts rather than as expired.
	const past = coverage.filter((p) => p.fin.getTime() <= today.getTime());
	if (past.length === 0) {
		return { ...base, status: 'en_attente', datefin: null };
	}
	const lastFin = past[past.length - 1].fin;
	const finGrace = addUTCDays(lastFin, delaiGraceJours - 1); // inclusive last day of grace
	const datefin = addUTCDays(lastFin, -1);
	if (today.getTime() <= finGrace.getTime()) {
		return { ...base, status: 'en_grace', datefin, finGrace };
	}
	return { ...base, status: 'expiree', datefin, isInactive: true };
}

export async function getSituationForTiers(tiers: Tiers, today: Date = brusselsToday()): Promise<Situation> {
	const [{ delaiGraceJours }, history] = await Promise.all([getComptaSettings(), collectCotisations(tiers)]);
	return computeSituation(tiers, history, delaiGraceJours, today);
}

// Null when the logged-in member has no tiers yet — the same "compte introuvable" state the pages
// already handle, not an error.
export async function getSituationForUser(user: AppUser): Promise<Situation | null> {
	const tiers = await resolveTiersForUser(user);
	return tiers ? getSituationForTiers(tiers) : null;
}

export async function getCotisationStatusForUser(user: AppUser): Promise<CotisationStatus | null> {
	const situation = await getSituationForUser(user);
	return situation?.status ?? null;
}

interface LienCouvertureRow {
	personne_id: number;
	organisation_id: number;
	depuis: string;
	jusqua: string | null;
}

export interface TiersSituation {
	tiers: Tiers;
	situation: Situation;
}

// Every tiers with its status, for the treasury's overview — three queries in total rather than a
// handful per member, which is what mapping getSituationForTiers over the list would cost.
export async function listSituations(today: Date = brusselsToday()): Promise<TiersSituation[]> {
	const sql = await getDb();
	const [{ delaiGraceJours }, tiers, cotisationRows, lienRows] = await Promise.all([
		getComptaSettings(),
		listTiers(),
		sql<CotisationRow[]>`SELECT ${sql.unsafe(COTISATION_COLUMNS)} FROM cotisations ORDER BY debut DESC, id DESC`,
		sql<LienCouvertureRow[]>`
			SELECT personne_id, organisation_id, depuis::text AS depuis, jusqua::text AS jusqua
			FROM tiers_liens WHERE herite_adhesion
		`
	]);

	const byTiers = new Map<number, Cotisation[]>();
	for (const row of cotisationRows) {
		const c = rowToCotisation(row);
		const list = byTiers.get(c.tiersId);
		if (list) list.push(c);
		else byTiers.set(c.tiersId, [c]);
	}
	const names = new Map(tiers.map((t) => [t.id, tiersDisplayName(t)]));
	const liensByPersonne = new Map<number, LienCouvertureRow[]>();
	for (const l of lienRows) {
		const list = liensByPersonne.get(l.personne_id);
		if (list) list.push(l);
		else liensByPersonne.set(l.personne_id, [l]);
	}

	return tiers.map((t) => {
		const own = (byTiers.get(t.id) ?? []).map((c) => toHistorique(c, null));
		const inherited =
			t.nature === 'personne_physique'
				? (liensByPersonne.get(t.id) ?? []).flatMap((l) =>
						inheritedHistorique(
							byTiers.get(l.organisation_id) ?? [],
							{ depuis: parseIsoDate(l.depuis), jusqua: l.jusqua ? parseIsoDate(l.jusqua) : null },
							names.get(l.organisation_id) ?? '?'
						)
					)
				: [];
		return { tiers: t, situation: computeSituation(t, sortHistorique([...own, ...inherited]), delaiGraceJours, today) };
	});
}
