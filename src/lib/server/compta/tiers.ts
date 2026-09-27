import { getDb } from '$lib/server/db';
import { authentikPk, type AppUser } from '$lib/types';
import { normalizeIban } from '$lib/server/bankValidation';
import { brusselsToday, toIsoDate } from './dates';

// Third parties — the people and organisations the ASBL deals with. Model in docs/compta.md,
// "Tiers"; table in migration 10. Roles (client, fournisseur, adhérent, sponsor, membre) are not a
// type here: the first two are flags, the rest follow from cotisations and liens.

export type TiersNature = 'personne_physique' | 'personne_morale';

export interface Tiers {
	id: number;
	createdAt: Date;
	nature: TiersNature;
	nom: string;
	prenom: string | null;
	email: string | null;
	telephone: string | null;
	adresse: string | null;
	codePostal: string | null;
	ville: string | null;
	pays: string;
	numeroEntreprise: string | null;
	iban: string | null;
	authentikPk: number | null;
	exempteCotisation: boolean;
	estClient: boolean;
	estFournisseur: boolean;
	actif: boolean;
	notes: string | null;
	dolibarrMemberId: number | null;
	dolibarrSocId: number | null;
}

// Everything a treasurer edits by hand. The import keys and authentik_pk have their own paths.
export interface TiersInput {
	nature: TiersNature;
	nom: string;
	prenom: string | null;
	email: string | null;
	telephone: string | null;
	adresse: string | null;
	codePostal: string | null;
	ville: string | null;
	pays: string;
	numeroEntreprise: string | null;
	iban: string | null;
	exempteCotisation: boolean;
	estClient: boolean;
	estFournisseur: boolean;
	actif: boolean;
	notes: string | null;
}

interface TiersRow {
	id: number;
	created_at: Date;
	nature: TiersNature;
	nom: string;
	prenom: string | null;
	email: string | null;
	telephone: string | null;
	adresse: string | null;
	code_postal: string | null;
	ville: string | null;
	pays: string;
	numero_entreprise: string | null;
	iban: string | null;
	authentik_pk: number | null;
	exempte_cotisation: boolean;
	est_client: boolean;
	est_fournisseur: boolean;
	actif: boolean;
	notes: string | null;
	dolibarr_member_id: number | null;
	dolibarr_soc_id: number | null;
}

function rowToTiers(r: TiersRow): Tiers {
	return {
		id: r.id,
		createdAt: r.created_at,
		nature: r.nature,
		nom: r.nom,
		prenom: r.prenom,
		email: r.email,
		telephone: r.telephone,
		adresse: r.adresse,
		codePostal: r.code_postal,
		ville: r.ville,
		pays: r.pays,
		numeroEntreprise: r.numero_entreprise,
		iban: r.iban,
		authentikPk: r.authentik_pk,
		exempteCotisation: r.exempte_cotisation,
		estClient: r.est_client,
		estFournisseur: r.est_fournisseur,
		actif: r.actif,
		notes: r.notes,
		dolibarrMemberId: r.dolibarr_member_id,
		dolibarrSocId: r.dolibarr_soc_id
	};
}

// "Prénom Nom" for a person, the legal name for an organisation.
export function tiersDisplayName(t: Pick<Tiers, 'nature' | 'nom' | 'prenom'>): string {
	return t.nature === 'personne_physique' && t.prenom ? `${t.prenom} ${t.nom}` : t.nom;
}

export interface TiersFilter {
	nature?: TiersNature;
	// Case-insensitive match on name, first name, email or enterprise number.
	search?: string;
	actifOnly?: boolean;
}

export async function listTiers(filter: TiersFilter = {}): Promise<Tiers[]> {
	const sql = await getDb();
	const pattern = filter.search ? `%${filter.search.trim()}%` : null;
	const rows = await sql<TiersRow[]>`
		SELECT * FROM tiers
		WHERE ${filter.nature ? sql`nature = ${filter.nature}` : sql`true`}
		  AND ${filter.actifOnly ? sql`actif` : sql`true`}
		  AND ${
				pattern
					? sql`(nom ILIKE ${pattern} OR prenom ILIKE ${pattern} OR email ILIKE ${pattern} OR numero_entreprise ILIKE ${pattern})`
					: sql`true`
			}
		ORDER BY lower(nom), lower(prenom)
	`;
	return rows.map(rowToTiers);
}

export async function getTiers(id: number): Promise<Tiers | null> {
	const sql = await getDb();
	const [row] = await sql<TiersRow[]>`SELECT * FROM tiers WHERE id = ${id}`;
	return row ? rowToTiers(row) : null;
}

export async function findTiersByAuthentikPk(pk: number): Promise<Tiers | null> {
	const sql = await getDb();
	const [row] = await sql<TiersRow[]>`SELECT * FROM tiers WHERE authentik_pk = ${pk}`;
	return row ? rowToTiers(row) : null;
}

// Persons only: an organisation may share its contact's email (Dolibarr had exactly that case),
// and it's never the one logging in.
export async function findPersonneByEmail(email: string): Promise<Tiers | null> {
	const sql = await getDb();
	const [row] = await sql<TiersRow[]>`
		SELECT * FROM tiers
		WHERE nature = 'personne_physique' AND lower(email) = lower(${email})
		ORDER BY authentik_pk IS NULL, id
		LIMIT 1
	`;
	return row ? rowToTiers(row) : null;
}

// The tiers behind the logged-in member, or null when there is none — a plausible state (not yet
// registered in the books), not an error, same as the old "no Dolibarr member" case.
//
// authentik_pk is the key; the email fallback exists because the Dolibarr import only knows
// emails. The first login after the import stamps the pk, and from then on a member can change
// their email in Authentik without losing their books.
export async function resolveTiersForUser(user: AppUser): Promise<Tiers | null> {
	const pk = authentikPk(user);
	if (pk !== null) {
		const byPk = await findTiersByAuthentikPk(pk);
		if (byPk) return byPk;
	}
	if (!user.email) return null;

	const byEmail = await findPersonneByEmail(user.email);
	if (!byEmail) return null;

	if (pk !== null && byEmail.authentikPk === null) {
		const sql = await getDb();
		// `authentik_pk IS NULL` guard: two concurrent first logins can't both claim the row, and
		// UNIQUE(authentik_pk) already stops one account claiming two tiers.
		await sql`
			UPDATE tiers SET authentik_pk = ${pk}, updated_at = now()
			WHERE id = ${byEmail.id} AND authentik_pk IS NULL
		`;
		return { ...byEmail, authentikPk: pk };
	}
	return byEmail;
}

function nullIfBlank(value: string | null): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed === '' ? null : trimmed;
}

// Trims, blanks-to-null, canonical IBAN — one place, so every write path stores the same shape and
// the IBAN conflict check below compares like with like.
function normaliseInput(input: TiersInput): TiersInput {
	return {
		...input,
		nom: input.nom.trim(),
		prenom: input.nature === 'personne_physique' ? nullIfBlank(input.prenom) : null,
		email: nullIfBlank(input.email),
		telephone: nullIfBlank(input.telephone),
		adresse: nullIfBlank(input.adresse),
		codePostal: nullIfBlank(input.codePostal),
		ville: nullIfBlank(input.ville),
		pays: nullIfBlank(input.pays) ?? 'BE',
		numeroEntreprise: input.nature === 'personne_morale' ? nullIfBlank(input.numeroEntreprise) : null,
		iban: input.iban ? normalizeIban(input.iban) || null : null,
		notes: nullIfBlank(input.notes)
	};
}

export async function createTiers(input: TiersInput): Promise<Tiers> {
	const sql = await getDb();
	const t = normaliseInput(input);
	const [row] = await sql<TiersRow[]>`
		INSERT INTO tiers (
			nature, nom, prenom, email, telephone, adresse, code_postal, ville, pays,
			numero_entreprise, iban, exempte_cotisation, est_client, est_fournisseur, actif, notes
		) VALUES (
			${t.nature}, ${t.nom}, ${t.prenom}, ${t.email}, ${t.telephone}, ${t.adresse}, ${t.codePostal},
			${t.ville}, ${t.pays}, ${t.numeroEntreprise}, ${t.iban}, ${t.exempteCotisation}, ${t.estClient},
			${t.estFournisseur}, ${t.actif}, ${t.notes}
		)
		RETURNING *
	`;
	return rowToTiers(row);
}

export async function updateTiers(id: number, input: TiersInput): Promise<Tiers | null> {
	const sql = await getDb();
	const t = normaliseInput(input);
	const [row] = await sql<TiersRow[]>`
		UPDATE tiers SET
			nature = ${t.nature}, nom = ${t.nom}, prenom = ${t.prenom}, email = ${t.email},
			telephone = ${t.telephone}, adresse = ${t.adresse}, code_postal = ${t.codePostal},
			ville = ${t.ville}, pays = ${t.pays}, numero_entreprise = ${t.numeroEntreprise}, iban = ${t.iban},
			exempte_cotisation = ${t.exempteCotisation}, est_client = ${t.estClient},
			est_fournisseur = ${t.estFournisseur}, actif = ${t.actif}, notes = ${t.notes},
			updated_at = now()
		WHERE id = ${id}
		RETURNING *
	`;
	return row ? rowToTiers(row) : null;
}

// The member-facing IBAN update (/cotisation) — a person edits their own IBAN, and the IBAN of an
// organisation they administer. Empty string clears it.
export async function updateTiersIban(id: number, iban: string): Promise<void> {
	const sql = await getDb();
	const value = normalizeIban(iban) || null;
	await sql`UPDATE tiers SET iban = ${value}, updated_at = now() WHERE id = ${id}`;
}

// Stops a member from entering someone else's IBAN. The caller's own tiers are excluded — a person
// and their one-person company legitimately share one (the "indépendant" case).
export async function findIbanOwnerConflict(iban: string, excludeTiersIds: number[]): Promise<boolean> {
	const value = normalizeIban(iban);
	if (!value) return false;
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		SELECT id FROM tiers
		WHERE iban = ${value} AND id <> ALL(${excludeTiersIds})
		LIMIT 1
	`;
	return row !== undefined;
}

// Organisations a person currently administers (open link with est_administrateur) — the ones
// whose invoices they see and whose IBAN they may edit from /cotisation.
export async function listOrganisationsAdministrees(personneId: number, today: Date = brusselsToday()): Promise<Tiers[]> {
	const sql = await getDb();
	const iso = toIsoDate(today);
	const rows = await sql<TiersRow[]>`
		SELECT t.* FROM tiers t
		JOIN tiers_liens l ON l.organisation_id = t.id
		WHERE l.personne_id = ${personneId}
		  AND l.est_administrateur
		  AND l.depuis <= ${iso}::date AND (l.jusqua IS NULL OR ${iso}::date < l.jusqua)
		ORDER BY lower(t.nom)
	`;
	return rows.map(rowToTiers);
}
