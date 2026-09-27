import type postgres from 'postgres';
import { getDb } from '$lib/server/db';
import { normalizeIban } from '$lib/server/bankValidation';
import { parseIsoDate, parseMoney, toIsoDate } from './dates';
import { getFacture, listFactures, marquerPayee, type Facture } from './factures';
import { createCotisation, getCotisation } from './cotisations';
import { getTiers, tiersDisplayName, type Tiers } from './tiers';
import { getNoteDeFrais, listNotesDeFrais, type NoteDeFrais } from './notesDeFrais';
import type { MouvementImporte } from './belfiusCsv';

// Bank and cash accounts, their movements, internal transfers, and the matching (lettrage) of
// movements against invoices and dues — docs/compta.md, "Banque et caisse"; tables in migration 12.
//
// Lettrage is what settles things: an issued invoice becomes `payee` once the allocations against
// it reach its total (which activates the cotisation it carries), a received invoice likewise, an
// `attendue` cotisation becomes active, and a person's free-amount payment becomes a new `libre`
// cotisation. "Marquer payée" on an invoice stays available for a payment that never went through
// an account here (cash handed over before the caisse existed, an old Dolibarr invoice).

export type CompteType = 'banque' | 'caisse';

export interface Compte {
	id: number;
	type: CompteType;
	nom: string;
	iban: string | null;
	soldeOuverture: number;
	dateOuverture: Date;
	actif: boolean;
	// solde_ouverture + every movement, computed on read.
	solde: number;
	nonLettres: number;
}

export interface CompteInput {
	type: CompteType;
	nom: string;
	iban: string | null;
	soldeOuverture: number;
	dateOuverture: Date;
	actif: boolean;
}

interface CompteRow {
	id: number;
	type: CompteType;
	nom: string;
	iban: string | null;
	solde_ouverture: string;
	date_ouverture: string;
	actif: boolean;
	solde: string;
	non_lettres: number;
}

function rowToCompte(r: CompteRow): Compte {
	return {
		id: r.id,
		type: r.type,
		nom: r.nom,
		iban: r.iban,
		soldeOuverture: parseMoney(r.solde_ouverture),
		dateOuverture: parseIsoDate(r.date_ouverture),
		actif: r.actif,
		solde: parseMoney(r.solde),
		nonLettres: r.non_lettres
	};
}

// Movements whose allocations don't add up to their amount — what the treasury still has to look
// at. Computed the same way for the account counter and the movement's own `reste`.
const COMPTE_SELECT = `
	SELECT c.id, c.type, c.nom, c.iban, c.solde_ouverture, c.date_ouverture::text AS date_ouverture, c.actif,
	       c.solde_ouverture + COALESCE((SELECT sum(m.montant) FROM mouvements m WHERE m.compte_id = c.id), 0) AS solde,
	       (SELECT count(*)::int FROM mouvements m
	         WHERE m.compte_id = c.id AND m.transfert_id IS NULL
	           AND abs(m.montant) > COALESCE((SELECT sum(l.montant) FROM lettrages l WHERE l.mouvement_id = m.id), 0)
	       ) AS non_lettres
	FROM comptes c
`;

export async function listComptes(): Promise<Compte[]> {
	const sql = await getDb();
	const rows = await sql<CompteRow[]>`${sql.unsafe(COMPTE_SELECT)} ORDER BY c.actif DESC, c.type, lower(c.nom)`;
	return rows.map(rowToCompte);
}

export async function getCompte(id: number): Promise<Compte | null> {
	const sql = await getDb();
	const [row] = await sql<CompteRow[]>`${sql.unsafe(COMPTE_SELECT)} WHERE c.id = ${id}`;
	return row ? rowToCompte(row) : null;
}

export async function createCompte(input: CompteInput): Promise<Compte> {
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO comptes (type, nom, iban, solde_ouverture, date_ouverture, actif)
		VALUES (${input.type}, ${input.nom.trim()}, ${input.iban ? normalizeIban(input.iban) || null : null},
		        ${input.soldeOuverture}, ${toIsoDate(input.dateOuverture)}, ${input.actif})
		RETURNING id
	`;
	return (await getCompte(row.id)) as Compte;
}

export async function updateCompte(id: number, input: CompteInput): Promise<Compte | null> {
	const sql = await getDb();
	await sql`
		UPDATE comptes SET type = ${input.type}, nom = ${input.nom.trim()}, iban = ${input.iban ? normalizeIban(input.iban) || null : null},
			solde_ouverture = ${input.soldeOuverture}, date_ouverture = ${toIsoDate(input.dateOuverture)}, actif = ${input.actif}
		WHERE id = ${id}
	`;
	return getCompte(id);
}

// ---------------------------------------------------------------------------------------------
// Movements

export interface Mouvement {
	id: number;
	compteId: number;
	compteNom: string;
	dateValeur: Date;
	montant: number;
	libelle: string;
	contrepartieNom: string | null;
	contrepartieIban: string | null;
	communication: string | null;
	importId: number | null;
	externalId: string | null;
	transfertId: number | null;
	// Sum of allocations (always positive) and what's left to allocate of |montant|.
	lettre: number;
	reste: number;
}

export interface MouvementInput {
	compteId: number;
	dateValeur: Date;
	montant: number;
	libelle: string;
	contrepartieNom: string | null;
	contrepartieIban: string | null;
	communication: string | null;
}

interface MouvementRow {
	id: number;
	compte_id: number;
	compte_nom: string;
	date_valeur: string;
	montant: string;
	libelle: string;
	contrepartie_nom: string | null;
	contrepartie_iban: string | null;
	communication: string | null;
	import_id: number | null;
	external_id: string | null;
	transfert_id: number | null;
	lettre: string;
}

function rowToMouvement(r: MouvementRow): Mouvement {
	const montant = parseMoney(r.montant);
	const lettre = parseMoney(r.lettre);
	return {
		id: r.id,
		compteId: r.compte_id,
		compteNom: r.compte_nom,
		dateValeur: parseIsoDate(r.date_valeur),
		montant,
		libelle: r.libelle,
		contrepartieNom: r.contrepartie_nom,
		contrepartieIban: r.contrepartie_iban,
		communication: r.communication,
		importId: r.import_id,
		externalId: r.external_id,
		transfertId: r.transfert_id,
		lettre,
		// A transfer leg has nothing to allocate: it's matched by its other leg.
		reste: r.transfert_id !== null ? 0 : Math.max(0, Math.round((Math.abs(montant) - lettre) * 100) / 100)
	};
}

const MOUVEMENT_SELECT = `
	SELECT m.id, m.compte_id, c.nom AS compte_nom, m.date_valeur::text AS date_valeur, m.montant, m.libelle,
	       m.contrepartie_nom, m.contrepartie_iban, m.communication, m.import_id, m.external_id, m.transfert_id,
	       COALESCE((SELECT sum(l.montant) FROM lettrages l WHERE l.mouvement_id = m.id), 0) AS lettre
	FROM mouvements m
	JOIN comptes c ON c.id = m.compte_id
`;

export async function listMouvements(compteId: number, limit = 300): Promise<Mouvement[]> {
	const sql = await getDb();
	const rows = await sql<MouvementRow[]>`
		${sql.unsafe(MOUVEMENT_SELECT)} WHERE m.compte_id = ${compteId}
		ORDER BY m.date_valeur DESC, m.id DESC LIMIT ${limit}
	`;
	return rows.map(rowToMouvement);
}

// Across all accounts, oldest first: the treasury's to-do list.
export async function listMouvementsNonLettres(limit = 200): Promise<Mouvement[]> {
	const sql = await getDb();
	const rows = await sql<MouvementRow[]>`
		${sql.unsafe(MOUVEMENT_SELECT)}
		WHERE m.transfert_id IS NULL
		  AND abs(m.montant) > COALESCE((SELECT sum(l.montant) FROM lettrages l WHERE l.mouvement_id = m.id), 0)
		ORDER BY m.date_valeur, m.id LIMIT ${limit}
	`;
	return rows.map(rowToMouvement);
}

export async function getMouvement(id: number): Promise<Mouvement | null> {
	const sql = await getDb();
	const [row] = await sql<MouvementRow[]>`${sql.unsafe(MOUVEMENT_SELECT)} WHERE m.id = ${id}`;
	return row ? rowToMouvement(row) : null;
}

export class BanqueError extends Error {}

// A movement typed in by hand — cash mostly, or a bank line the export missed.
export async function createMouvement(input: MouvementInput): Promise<Mouvement> {
	if (input.montant === 0) throw new BanqueError('Le montant ne peut pas être nul.');
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO mouvements (compte_id, date_valeur, montant, libelle, contrepartie_nom, contrepartie_iban, communication)
		VALUES (${input.compteId}, ${toIsoDate(input.dateValeur)}, ${input.montant}, ${input.libelle.trim()},
		        ${input.contrepartieNom}, ${input.contrepartieIban ? normalizeIban(input.contrepartieIban) || null : null},
		        ${input.communication})
		RETURNING id
	`;
	return (await getMouvement(row.id)) as Mouvement;
}

// Two opposite legs created atomically and tied together, so neither ever shows up as something
// to allocate. Cash deposited at the bank, bank withdrawal into the caisse — same thing.
export async function virementInterne(input: { deId: number; versId: number; montant: number; dateValeur: Date; libelle: string }): Promise<number> {
	if (input.deId === input.versId) throw new BanqueError('Les deux comptes doivent être différents.');
	if (!(input.montant > 0)) throw new BanqueError('Le montant doit être positif.');
	const sql = await getDb();
	return sql.begin(async (tx) => {
		const libelle = input.libelle.trim() || 'Virement interne';
		const [de] = await tx<{ id: number }[]>`
			INSERT INTO mouvements (compte_id, date_valeur, montant, libelle)
			VALUES (${input.deId}, ${toIsoDate(input.dateValeur)}, ${-input.montant}, ${libelle}) RETURNING id
		`;
		await tx`
			INSERT INTO mouvements (compte_id, date_valeur, montant, libelle, transfert_id)
			VALUES (${input.versId}, ${toIsoDate(input.dateValeur)}, ${input.montant}, ${libelle}, ${de.id})
		`;
		await tx`UPDATE mouvements SET transfert_id = ${de.id} WHERE id = ${de.id}`;
		return de.id;
	});
}

export interface ImportResult {
	importId: number;
	lignes: number;
	nouvelles: number;
	// Already present (same external id on this account) — an overlapping export, not an error.
	ignorees: number;
	lettresAuto: number;
}

// Inserts what the CSV reader produced, skipping lines already known, then tries to settle the
// new money-in lines by structured communication.
export async function importerMouvements(compteId: number, mouvements: MouvementImporte[], meta: { nomFichier: string; actorSub: string }): Promise<ImportResult> {
	const sql = await getDb();
	const newIds: number[] = [];
	const importId = await sql.begin(async (tx) => {
		const [imp] = await tx<{ id: number }[]>`
			INSERT INTO imports_bancaires (compte_id, nom_fichier, lignes, nouvelles, actor_sub)
			VALUES (${compteId}, ${meta.nomFichier}, ${mouvements.length}, 0, ${meta.actorSub}) RETURNING id
		`;
		for (const m of mouvements) {
			const [row] = await tx<{ id: number }[]>`
				INSERT INTO mouvements (compte_id, date_valeur, montant, libelle, contrepartie_nom, contrepartie_iban, communication, import_id, external_id)
				VALUES (${compteId}, ${toIsoDate(m.dateValeur)}, ${m.montant}, ${m.libelle}, ${m.contrepartieNom}, ${m.contrepartieIban},
				        ${m.communication}, ${imp.id}, ${m.externalId})
				ON CONFLICT (compte_id, external_id) DO NOTHING
				RETURNING id
			`;
			if (row) newIds.push(row.id);
		}
		await tx`UPDATE imports_bancaires SET nouvelles = ${newIds.length} WHERE id = ${imp.id}`;
		return imp.id;
	});
	const lettresAuto = await autoLettrer(newIds);
	return { importId, lignes: mouvements.length, nouvelles: newIds.length, ignorees: mouvements.length - newIds.length, lettresAuto };
}

// ---------------------------------------------------------------------------------------------
// Lettrage

export type CibleType = 'facture' | 'cotisation' | 'note_de_frais' | 'autre';

export interface Lettrage {
	id: number;
	mouvementId: number;
	cibleType: CibleType;
	cibleId: number | null;
	montant: number;
	libelle: string | null;
	// Human label and link for the target, resolved on read.
	cibleLabel: string;
	cibleHref: string | null;
}

interface LettrageRow {
	id: number;
	mouvement_id: number;
	cible_type: CibleType;
	cible_id: number | null;
	montant: string;
	libelle: string | null;
	facture_numero: string | null;
	facture_tiers_id: number | null;
	cotisation_tiers_id: number | null;
	cotisation_debut: string | null;
	note_tiers_id: number | null;
	note_libelle: string | null;
	tiers_nom: string | null;
	tiers_prenom: string | null;
	tiers_nature: 'personne_physique' | 'personne_morale' | null;
}

function rowToLettrage(r: LettrageRow): Lettrage {
	const tiers = r.tiers_nature && r.tiers_nom ? tiersDisplayName({ nature: r.tiers_nature, nom: r.tiers_nom, prenom: r.tiers_prenom }) : null;
	let cibleLabel = r.libelle ?? 'Autre';
	let cibleHref: string | null = null;
	if (r.cible_type === 'facture') {
		cibleLabel = `Facture ${r.facture_numero ?? `#${r.cible_id}`}${tiers ? ` — ${tiers}` : ''}`;
		cibleHref = `/compta/factures/${r.cible_id}`;
	} else if (r.cible_type === 'cotisation') {
		cibleLabel = `Cotisation${tiers ? ` ${tiers}` : ''}${r.cotisation_debut ? ` (${r.cotisation_debut.slice(0, 7)})` : ''}`;
		cibleHref = r.cotisation_tiers_id ? `/compta/tiers/${r.cotisation_tiers_id}` : null;
	} else if (r.cible_type === 'note_de_frais') {
		cibleLabel = `Note de frais${tiers ? ` ${tiers}` : ''}${r.note_libelle ? ` — ${r.note_libelle}` : ''}`;
		cibleHref = `/compta/notes-de-frais`;
	}
	return {
		id: r.id,
		mouvementId: r.mouvement_id,
		cibleType: r.cible_type,
		cibleId: r.cible_id,
		montant: parseMoney(r.montant),
		libelle: r.libelle,
		cibleLabel,
		cibleHref
	};
}

const LETTRAGE_SELECT = `
	SELECT l.id, l.mouvement_id, l.cible_type, l.cible_id, l.montant, l.libelle,
	       f.numero AS facture_numero, f.tiers_id AS facture_tiers_id,
	       co.tiers_id AS cotisation_tiers_id, co.debut::text AS cotisation_debut,
	       n.tiers_id AS note_tiers_id, n.libelle AS note_libelle,
	       t.nom AS tiers_nom, t.prenom AS tiers_prenom, t.nature AS tiers_nature
	FROM lettrages l
	LEFT JOIN factures f ON l.cible_type = 'facture' AND f.id = l.cible_id
	LEFT JOIN cotisations co ON l.cible_type = 'cotisation' AND co.id = l.cible_id
	LEFT JOIN notes_de_frais n ON l.cible_type = 'note_de_frais' AND n.id = l.cible_id
	LEFT JOIN tiers t ON t.id = COALESCE(f.tiers_id, co.tiers_id, n.tiers_id)
`;

export async function listLettrages(mouvementId: number): Promise<Lettrage[]> {
	const sql = await getDb();
	const rows = await sql<LettrageRow[]>`${sql.unsafe(LETTRAGE_SELECT)} WHERE l.mouvement_id = ${mouvementId} ORDER BY l.id`;
	return rows.map(rowToLettrage);
}

export async function listLettragesDeFacture(factureId: number): Promise<Lettrage[]> {
	const sql = await getDb();
	const rows = await sql<LettrageRow[]>`${sql.unsafe(LETTRAGE_SELECT)} WHERE l.cible_type = 'facture' AND l.cible_id = ${factureId} ORDER BY l.id`;
	return rows.map(rowToLettrage);
}

async function totalLettre(sql: postgres.Sql | postgres.TransactionSql, cibleType: CibleType, cibleId: number): Promise<number> {
	const [row] = await sql<{ total: string }[]>`
		SELECT COALESCE(sum(montant), 0) AS total FROM lettrages WHERE cible_type = ${cibleType} AND cible_id = ${cibleId}
	`;
	return parseMoney(row.total);
}

export interface CibleInput {
	type: CibleType;
	id: number | null;
	libelle?: string | null;
}

// Allocates `montant` (positive) of a movement to a target, then settles the target if that
// completes it. Refuses to over-allocate either side.
export async function lettrer(mouvementId: number, cible: CibleInput, montant: number): Promise<Lettrage> {
	if (!(montant > 0)) throw new BanqueError('Le montant à lettrer doit être positif.');
	const mouvement = await getMouvement(mouvementId);
	if (!mouvement) throw new BanqueError('Mouvement introuvable.');
	if (mouvement.transfertId !== null) throw new BanqueError('Un virement interne ne se lettre pas.');
	if (montant > mouvement.reste + 0.005) throw new BanqueError(`Il ne reste que ${mouvement.reste.toFixed(2)} € à lettrer sur ce mouvement.`);

	const sql = await getDb();
	const id = await sql.begin(async (tx) => {
		if (cible.type === 'facture') {
			const facture = cible.id ? await getFacture(cible.id) : null;
			if (!facture || facture.statut !== 'validee') throw new BanqueError('Seule une facture validée, non payée, peut être lettrée.');
			// Money in settles an issued invoice, money out a received one (a credit note is the
			// other way round: money out settles an issued credit note).
			const attendu = (facture.sens === 'emise') !== (facture.type === 'note_de_credit') ? 1 : -1;
			if (Math.sign(mouvement.montant) !== attendu) throw new BanqueError('Le sens du mouvement ne correspond pas à cette facture.');
			const deja = await totalLettre(tx, 'facture', facture.id);
			const reste = Math.round((Math.abs(facture.total) - deja) * 100) / 100;
			if (montant > reste + 0.005) throw new BanqueError(`Il ne reste que ${reste.toFixed(2)} € à payer sur cette facture.`);
		} else if (cible.type === 'cotisation') {
			const cotisation = cible.id ? await getCotisation(cible.id) : null;
			if (!cotisation || cotisation.statut !== 'attendue') throw new BanqueError('Seule une cotisation en attente de paiement peut être lettrée.');
			if (mouvement.montant <= 0) throw new BanqueError('Une cotisation se lettre avec une entrée d’argent.');
		} else if (cible.type === 'note_de_frais') {
			const note = cible.id ? await getNoteDeFrais(cible.id) : null;
			if (!note || note.statut !== 'acceptee') throw new BanqueError('Seule une note de frais acceptée, non remboursée, peut être lettrée.');
			if (mouvement.montant >= 0) throw new BanqueError('Un remboursement de frais est une sortie d’argent.');
			const deja = await totalLettre(tx, 'note_de_frais', note.id);
			const reste = Math.round((note.montant - deja) * 100) / 100;
			if (montant > reste + 0.005) throw new BanqueError(`Il ne reste que ${reste.toFixed(2)} € à rembourser sur cette note.`);
		}

		const [row] = await tx<{ id: number }[]>`
			INSERT INTO lettrages (mouvement_id, cible_type, cible_id, montant, libelle)
			VALUES (${mouvementId}, ${cible.type}, ${cible.id}, ${montant}, ${cible.libelle?.trim() || null}) RETURNING id
		`;

		if (cible.type === 'facture' && cible.id) {
			const facture = (await getFacture(cible.id)) as Facture;
			const total = await totalLettre(tx, 'facture', facture.id);
			if (total + 0.005 >= Math.abs(facture.total)) {
				await marquerPayee(facture.id, mouvement.dateValeur);
			}
		} else if (cible.type === 'cotisation' && cible.id) {
			await tx`UPDATE cotisations SET statut = 'active', paye_le = ${toIsoDate(mouvement.dateValeur)} WHERE id = ${cible.id} AND statut = 'attendue'`;
		} else if (cible.type === 'note_de_frais' && cible.id) {
			const note = (await getNoteDeFrais(cible.id)) as NoteDeFrais;
			if ((await totalLettre(tx, 'note_de_frais', note.id)) + 0.005 >= note.montant) {
				await tx`UPDATE notes_de_frais SET statut = 'remboursee', remboursee_le = ${toIsoDate(mouvement.dateValeur)} WHERE id = ${note.id}`;
			}
		}
		return row.id;
	});
	const [lettrage] = await listLettrages(mouvementId).then((all) => all.filter((l) => l.id === id));
	return lettrage;
}

// Removes an allocation and un-settles the target if it no longer adds up.
export async function delettrer(lettrageId: number): Promise<void> {
	const sql = await getDb();
	await sql.begin(async (tx) => {
		const [l] = await tx<{ cible_type: CibleType; cible_id: number | null }[]>`
			DELETE FROM lettrages WHERE id = ${lettrageId} RETURNING cible_type, cible_id
		`;
		if (!l || !l.cible_id) return;
		if (l.cible_type === 'facture') {
			const facture = await getFacture(l.cible_id);
			if (facture?.statut === 'payee' && (await totalLettre(tx, 'facture', facture.id)) + 0.005 < Math.abs(facture.total)) {
				await tx`UPDATE factures SET statut = 'validee', payee_le = NULL, updated_at = now() WHERE id = ${facture.id}`;
				await tx`UPDATE cotisations SET statut = 'attendue', paye_le = NULL WHERE facture_id = ${facture.id} AND statut = 'active'`;
			}
		} else if (l.cible_type === 'cotisation') {
			if ((await totalLettre(tx, 'cotisation', l.cible_id)) === 0) {
				await tx`UPDATE cotisations SET statut = 'attendue', paye_le = NULL WHERE id = ${l.cible_id} AND statut = 'active' AND facture_id IS NULL`;
			}
		} else if (l.cible_type === 'note_de_frais') {
			const note = await getNoteDeFrais(l.cible_id);
			if (note?.statut === 'remboursee' && (await totalLettre(tx, 'note_de_frais', note.id)) + 0.005 < note.montant) {
				await tx`UPDATE notes_de_frais SET statut = 'acceptee', remboursee_le = NULL WHERE id = ${note.id}`;
			}
		}
	});
}

// A person's free-amount payment: the cotisation is created directly active, for the period the
// treasurer decided from the communication, the amount or what the member said.
export async function creerCotisationLibre(mouvementId: number, input: { tiersId: number; debut: Date; fin: Date; note: string | null }): Promise<void> {
	const mouvement = await getMouvement(mouvementId);
	if (!mouvement) throw new BanqueError('Mouvement introuvable.');
	if (mouvement.montant <= 0) throw new BanqueError('Une cotisation se crée depuis une entrée d’argent.');
	if (mouvement.reste <= 0) throw new BanqueError('Ce mouvement est déjà entièrement lettré.');
	const tiers = await getTiers(input.tiersId);
	if (!tiers) throw new BanqueError('Tiers introuvable.');
	const cotisation = await createCotisation({
		tiersId: tiers.id,
		type: 'libre',
		debut: input.debut,
		fin: input.fin,
		montant: mouvement.reste,
		sieges: 1,
		statut: 'active',
		abonnementId: null,
		factureId: null,
		payeLe: mouvement.dateValeur,
		note: input.note
	});
	const sql = await getDb();
	await sql`
		INSERT INTO lettrages (mouvement_id, cible_type, cible_id, montant)
		VALUES (${mouvementId}, 'cotisation', ${cotisation.id}, ${mouvement.reste})
	`;
}

// Digits only, so "+++202/6000/00192+++", "202600000192" and "***202/6000/00192***" all compare equal.
function communicationDigits(raw: string | null): string | null {
	const digits = (raw ?? '').replace(/\D/g, '');
	return digits.length === 12 ? digits : null;
}

// Settles new money-in movements whose structured communication names one of our unpaid invoices.
// Only an exact match on the full 12 digits, and only what the invoice still owes — anything
// else stays for the treasurer.
export async function autoLettrer(mouvementIds: number[]): Promise<number> {
	if (mouvementIds.length === 0) return 0;
	const sql = await getDb();
	let done = 0;
	for (const id of mouvementIds) {
		const m = await getMouvement(id);
		if (!m || m.montant <= 0 || m.reste <= 0) continue;
		const digits = communicationDigits(m.communication);
		if (!digits) continue;
		const [f] = await sql<{ id: number; total: string }[]>`
			SELECT id, total FROM factures
			WHERE sens = 'emise' AND statut = 'validee' AND regexp_replace(communication_structuree, '\\D', '', 'g') = ${digits}
		`;
		if (!f) continue;
		const deja = await totalLettre(sql, 'facture', f.id);
		const montant = Math.min(m.reste, Math.round((parseMoney(f.total) - deja) * 100) / 100);
		if (montant <= 0) continue;
		try {
			await lettrer(m.id, { type: 'facture', id: f.id }, montant);
			done += 1;
		} catch (err) {
			console.error(`[banque] lettrage automatique du mouvement ${m.id} refusé:`, (err as Error).message);
		}
	}
	return done;
}

export interface Suggestions {
	// Unpaid invoices in the right direction, the counterparty's own first.
	factures: Facture[];
	// Accepted, unrefunded expense claims — for money out only.
	notes: NoteDeFrais[];
	// Who the counterparty IBAN belongs to, if we know it.
	tiers: Tiers | null;
}

export async function suggestionsPour(mouvement: Mouvement): Promise<Suggestions> {
	const sql = await getDb();
	let tiers: Tiers | null = null;
	if (mouvement.contrepartieIban) {
		const [row] = await sql<{ id: number }[]>`SELECT id FROM tiers WHERE iban = ${mouvement.contrepartieIban} LIMIT 1`;
		if (row) tiers = await getTiers(row.id);
	}
	const sens = mouvement.montant > 0 ? 'emise' : 'recue';
	const factures = (await listFactures({ sens, statut: 'validee' })).sort(
		(a, b) => Number(b.tiersId === tiers?.id) - Number(a.tiersId === tiers?.id)
	);
	const notes = mouvement.montant < 0 ? await listNotesDeFrais({ statut: 'acceptee' }) : [];
	return { factures, notes, tiers };
}
