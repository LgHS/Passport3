import type postgres from 'postgres';
import { getDb } from '$lib/server/db';
import { parseIsoDate, toIsoDate } from './dates';
import type { TiersNature } from './tiers';

// Person ↔ organisation links (table tiers_liens, migration 10). A link carries cumulative roles
// and a period; it's closed with `jusqua`, never deleted — see docs/compta.md, "Liens".

export interface Lien {
	id: number;
	organisationId: number;
	personneId: number;
	estEmploye: boolean;
	estAdministrateur: boolean;
	estContact: boolean;
	destinataireFactures: boolean;
	heriteAdhesion: boolean;
	depuis: Date;
	jusqua: Date | null;
	// The other side of the link, denormalised for lists (which side depends on the query).
	organisation: LienTiersSummary;
	personne: LienTiersSummary;
}

export interface LienTiersSummary {
	id: number;
	nature: TiersNature;
	nom: string;
	prenom: string | null;
	email: string | null;
	authentikPk: number | null;
}

export interface LienInput {
	organisationId: number;
	personneId: number;
	estEmploye: boolean;
	estAdministrateur: boolean;
	estContact: boolean;
	destinataireFactures: boolean;
	heriteAdhesion: boolean;
	depuis: Date;
	jusqua: Date | null;
}

interface LienRow {
	id: number;
	organisation_id: number;
	personne_id: number;
	est_employe: boolean;
	est_administrateur: boolean;
	est_contact: boolean;
	destinataire_factures: boolean;
	herite_adhesion: boolean;
	depuis: string;
	jusqua: string | null;
	o_nature: TiersNature;
	o_nom: string;
	o_prenom: string | null;
	o_email: string | null;
	o_authentik_pk: number | null;
	p_nature: TiersNature;
	p_nom: string;
	p_prenom: string | null;
	p_email: string | null;
	p_authentik_pk: number | null;
}

function rowToLien(r: LienRow): Lien {
	return {
		id: r.id,
		organisationId: r.organisation_id,
		personneId: r.personne_id,
		estEmploye: r.est_employe,
		estAdministrateur: r.est_administrateur,
		estContact: r.est_contact,
		destinataireFactures: r.destinataire_factures,
		heriteAdhesion: r.herite_adhesion,
		depuis: parseIsoDate(r.depuis),
		jusqua: r.jusqua ? parseIsoDate(r.jusqua) : null,
		organisation: {
			id: r.organisation_id,
			nature: r.o_nature,
			nom: r.o_nom,
			prenom: r.o_prenom,
			email: r.o_email,
			authentikPk: r.o_authentik_pk
		},
		personne: {
			id: r.personne_id,
			nature: r.p_nature,
			nom: r.p_nom,
			prenom: r.p_prenom,
			email: r.p_email,
			authentikPk: r.p_authentik_pk
		}
	};
}

// Shared SELECT so every reader gets both sides' summaries in one round trip.
async function selectLiens(where: (sql: postgres.Sql) => postgres.Fragment): Promise<Lien[]> {
	const sql = await getDb();
	const rows = await sql<LienRow[]>`
		SELECT l.id, l.organisation_id, l.personne_id, l.est_employe, l.est_administrateur, l.est_contact,
		       l.destinataire_factures, l.herite_adhesion, l.depuis::text AS depuis, l.jusqua::text AS jusqua,
		       o.nature AS o_nature, o.nom AS o_nom, o.prenom AS o_prenom, o.email AS o_email,
		       o.authentik_pk AS o_authentik_pk,
		       p.nature AS p_nature, p.nom AS p_nom, p.prenom AS p_prenom, p.email AS p_email,
		       p.authentik_pk AS p_authentik_pk
		FROM tiers_liens l
		JOIN tiers o ON o.id = l.organisation_id
		JOIN tiers p ON p.id = l.personne_id
		WHERE ${where(sql)}
		ORDER BY l.jusqua IS NOT NULL, lower(p.nom), lower(p.prenom), lower(o.nom)
	`;
	return rows.map(rowToLien);
}

export async function listLiensOfOrganisation(organisationId: number): Promise<Lien[]> {
	return selectLiens((sql) => sql`l.organisation_id = ${organisationId}`);
}

export async function listLiensOfPersonne(personneId: number): Promise<Lien[]> {
	return selectLiens((sql) => sql`l.personne_id = ${personneId}`);
}

export async function getLien(id: number): Promise<Lien | null> {
	const [lien] = await selectLiens((sql) => sql`l.id = ${id}`);
	return lien ?? null;
}

// A link is "en cours" on a day when depuis ≤ day < jusqua (jusqua exclusive, like cotisation
// `fin`). Used both by the membership derivation and by the seat check below.
export function lienEnCours(lien: Pick<Lien, 'depuis' | 'jusqua'>, day: Date): boolean {
	return lien.depuis.getTime() <= day.getTime() && (lien.jusqua === null || day.getTime() < lien.jusqua.getTime());
}

export interface Sieges {
	// Seats granted by the organisation's current cotisation — the one covering `day`, else the
	// most recent non-cancelled one (an organisation between two periods keeps its contract size).
	total: number;
	// Open links with herite_adhesion, excluding `excludeLienId` (the link being edited).
	utilises: number;
}

export async function siegesOrganisation(organisationId: number, day: Date, excludeLienId?: number): Promise<Sieges> {
	const sql = await getDb();
	const iso = toIsoDate(day);
	const [seats] = await sql<{ sieges: number | null }[]>`
		SELECT sieges FROM cotisations
		WHERE tiers_id = ${organisationId} AND statut <> 'annulee'
		ORDER BY (debut <= ${iso}::date AND ${iso}::date < fin) DESC, debut DESC
		LIMIT 1
	`;
	const [used] = await sql<{ n: number }[]>`
		SELECT count(*)::int AS n FROM tiers_liens
		WHERE organisation_id = ${organisationId}
		  AND herite_adhesion
		  AND depuis <= ${iso}::date AND (jusqua IS NULL OR ${iso}::date < jusqua)
		  AND id <> ${excludeLienId ?? -1}
	`;
	return { total: seats?.sieges ?? 0, utilises: used.n };
}

export class SiegesEpuisesError extends Error {
	constructor(public readonly sieges: Sieges) {
		super(`Aucun siège disponible (${sieges.utilises}/${sieges.total} utilisés).`);
	}
}

// Both writes enforce the seat limit here rather than in the route, so no future caller can
// forget it. Only `heriteAdhesion` consumes a seat: a contact or administrator who isn't covered
// by the company is always allowed.
async function assertSiegeDisponible(input: LienInput, excludeLienId?: number): Promise<void> {
	if (!input.heriteAdhesion) return;
	const sieges = await siegesOrganisation(input.organisationId, input.depuis, excludeLienId);
	if (sieges.utilises >= sieges.total) {
		throw new SiegesEpuisesError(sieges);
	}
}

export async function createLien(input: LienInput): Promise<Lien> {
	await assertSiegeDisponible(input);
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO tiers_liens (
			organisation_id, personne_id, est_employe, est_administrateur, est_contact,
			destinataire_factures, herite_adhesion, depuis, jusqua
		) VALUES (
			${input.organisationId}, ${input.personneId}, ${input.estEmploye}, ${input.estAdministrateur},
			${input.estContact}, ${input.destinataireFactures}, ${input.heriteAdhesion},
			${toIsoDate(input.depuis)}, ${input.jusqua ? toIsoDate(input.jusqua) : null}
		)
		RETURNING id
	`;
	return (await getLien(row.id)) as Lien;
}

export async function updateLien(id: number, input: LienInput): Promise<Lien | null> {
	await assertSiegeDisponible(input, id);
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		UPDATE tiers_liens SET
			est_employe = ${input.estEmploye}, est_administrateur = ${input.estAdministrateur},
			est_contact = ${input.estContact}, destinataire_factures = ${input.destinataireFactures},
			herite_adhesion = ${input.heriteAdhesion}, depuis = ${toIsoDate(input.depuis)},
			jusqua = ${input.jusqua ? toIsoDate(input.jusqua) : null}
		WHERE id = ${id}
		RETURNING id
	`;
	return row ? getLien(row.id) : null;
}
