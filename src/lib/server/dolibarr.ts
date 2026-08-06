import { requireEnv } from '$lib/server/env';
import type { CotisationStatus } from '$lib/types';

function apiBase(): string {
	return `${requireEnv('DOLIBARR_URL').replace(/\/+$/, '')}/api/index.php/`;
}

async function dolibarrApiFetch(path: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(new URL(path, apiBase()), {
		...init,
		headers: {
			DOLAPIKEY: requireEnv('DOLIBARR_API_KEY'),
			'Content-Type': 'application/json',
			...init?.headers
		}
	});

	if (!res.ok) {
		throw new Error(`Dolibarr API request to ${path} failed (${res.status}): ${await res.text()}`);
	}

	return res;
}

export interface DolibarrMember {
	id: number;
	// Vraie convention Dolibarr (adherent.class.php) : -1 = brouillon, 0 = résilié, 1 = validé —
	// confirmé empiriquement (une adhésion neuve et jamais validée est à -1, pas 0).
	statut: number;
	datefin: string | number | null; // épochs Unix OU date ISO selon l'instance — voir parseDolibarrDate()
	typeid: number | null;
	fkSoc: number | null; // tiers de facturation lié — non null = adhérent "pro"
	ibanPerso: string | null;
}

// Le champ `datefin` (et pareil pour dateadh/datef sur les souscriptions) revient tantôt en
// epoch Unix, tantôt en date ISO (ex: "2027-08-15") selon l'instance/version Dolibarr — confirmé
// empiriquement dans loic-local-dev/test_coti.sh, qui gère explicitement les deux formats plutôt
// que de supposer un epoch numérique. `null`/""/0/"0" veut dire "pas de date" (ex: aucune
// cotisation encore reçue).
export function parseDolibarrDate(raw: string | number | null | undefined): Date | null {
	if (raw === null || raw === undefined || raw === '' || raw === 0 || raw === '0') {
		return null;
	}

	if (typeof raw === 'number' || /^\d+$/.test(raw)) {
		return new Date(Number(raw) * 1000);
	}

	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface RawMemberRecord {
	id: string | number;
	statut: string | number;
	datefin?: string | number | null;
	typeid?: string | number;
	fk_adherent_type?: string | number;
	type_id?: string | number;
	fk_soc?: string | number | null;
	array_options?: { options_iban_perso?: string | null };
}

// `fk_adherent_type` est le nom de colonne réel en base ; `typeid`/`type_id` sont des alias vus
// exposés par l'API selon la version. Ordre de priorité confirmé empiriquement contre l'instance
// LgHS (voir loic-local-dev/test_coti.sh) : fk_adherent_type d'abord.
function resolveTypeId(record: RawMemberRecord): number | null {
	const raw = record.fk_adherent_type ?? record.typeid ?? record.type_id;
	const id = Number(raw);
	return Number.isInteger(id) && id > 0 ? id : null;
}

// Same defensive parsing as resolveTypeId(): this Dolibarr instance is already known to send
// "0" (a truthy JS string!) as a "no value" sentinel on other fields (see parseDolibarrDate) —
// a naive `record.fk_soc ? … : null` would turn that into fkSoc = 0 instead of null, making
// isPro wrongly true while the `if (member.fkSoc)` checks elsewhere (falsy on 0) silently skip
// the actual thirdparty call.
function resolveFkSoc(raw: string | number | null | undefined): number | null {
	if (raw === null || raw === undefined || raw === '' || raw === 0 || raw === '0') return null;
	const id = Number(raw);
	return Number.isInteger(id) && id > 0 ? id : null;
}

export async function getMemberByEmail(email: string): Promise<DolibarrMember | null> {
	const filter = `(t.email:=:'${email.replace(/'/g, "\\'")}')`;
	const res = await dolibarrApiFetch(`members?sqlfilters=${encodeURIComponent(filter)}`);
	const results = (await res.json()) as RawMemberRecord[];
	const record = results[0];
	if (!record) return null;

	return {
		id: Number(record.id),
		statut: Number(record.statut),
		datefin: record.datefin ?? null,
		typeid: resolveTypeId(record),
		fkSoc: resolveFkSoc(record.fk_soc),
		ibanPerso: record.array_options?.options_iban_perso || null
	};
}

interface RawThirdPartyRecord {
	array_options?: { options_iban_pro?: string | null };
}

// Le tiers de facturation lié (fkSoc) porte l'IBAN "pro" — distinct de l'IBAN perso sur la fiche
// adhérent — utilisé pour payer la cotisation quand elle passe par la société plutôt que le
// membre lui-même.
export async function getThirdPartyIbanPro(thirdPartyId: number): Promise<string | null> {
	const res = await dolibarrApiFetch(`thirdparties/${thirdPartyId}`);
	const record = (await res.json()) as RawThirdPartyRecord;
	return record.array_options?.options_iban_pro || null;
}

interface RawExtrafieldsRecord {
	array_options?: Record<string, unknown>;
}

// Dolibarr's REST API uses PUT for updates (its Restler-based CRUD convention — GET/POST/PUT/
// DELETE — unlike Authentik's PATCH). Read-merge-write on array_options for the same reason as
// updateUserProfile() in authentikAdmin.ts: sending only the changed key risks clobbering
// sibling extrafields (e.g. options_peppol on a thirdparty) depending on how this Dolibarr
// version handles a partial array_options in the request body.
async function updateArrayOption(path: string, optionKey: string, value: string): Promise<void> {
	const current = await dolibarrApiFetch(path);
	const record = (await current.json()) as RawExtrafieldsRecord;
	const mergedOptions = { ...record.array_options, [optionKey]: value };

	await dolibarrApiFetch(path, {
		method: 'PUT',
		body: JSON.stringify({ array_options: mergedOptions })
	});
}

export async function updateMemberIbanPerso(memberId: number, iban: string): Promise<void> {
	await updateArrayOption(`members/${memberId}`, 'options_iban_perso', iban);
}

export async function updateThirdPartyIbanPro(thirdPartyId: number, iban: string): Promise<void> {
	await updateArrayOption(`thirdparties/${thirdPartyId}`, 'options_iban_pro', iban);
}

interface RawMemberIbanRecord {
	id: string | number;
	array_options?: { options_iban_perso?: string | null };
}

interface RawThirdPartyIbanRecord {
	id: string | number;
	array_options?: { options_iban_pro?: string | null };
}

// Dolibarr's sqlfilters can't query on extrafields (confirmed empirically — "Unknown column
// 'options_iban_perso' in 'WHERE'"), so there's no way to ask it directly "who owns this IBAN".
// Fetching the full members/thirdparties lists and comparing here is the only option — fine at
// this org's scale (a hackerspace, not thousands of members).
//
// Stops a member from registering an IBAN that's already tied to someone else's account (by
// mistake or on purpose). The one legitimate case where the same IBAN appears twice is an
// "indépendant" member whose personal and company accounts are the same — allowed only because
// both slots belong to the same person (their own member id / their own linked third-party id).
export async function findIbanOwnerConflict(
	iban: string,
	own: { memberId: number; fkSoc: number | null }
): Promise<boolean> {
	const [membersRes, thirdPartiesRes] = await Promise.all([
		dolibarrApiFetch('members?limit=1000'),
		dolibarrApiFetch('thirdparties?limit=1000')
	]);

	const members = (await membersRes.json()) as RawMemberIbanRecord[];
	const thirdParties = (await thirdPartiesRes.json()) as RawThirdPartyIbanRecord[];

	const usedByOtherMember = members.some(
		(m) => Number(m.id) !== own.memberId && m.array_options?.options_iban_perso === iban
	);
	const usedByOtherThirdParty = thirdParties.some(
		(t) => Number(t.id) !== own.fkSoc && t.array_options?.options_iban_pro === iban
	);

	return usedByOtherMember || usedByOtherThirdParty;
}

export interface DolibarrSubscription {
	id: number;
	start: Date | null; // dateadh
	end: Date | null; // datef
	amount: number;
}

interface RawSubscriptionRecord {
	rowid?: string | number;
	id?: string | number;
	dateh?: string | number; // confirmed against the real API — NOT `dateadh`
	datef?: string | number | null;
	amount?: string | number; // confirmed against the real API — NOT `subscription`/`montant`
}

export async function getMemberSubscriptions(memberId: number): Promise<DolibarrSubscription[]> {
	const res = await dolibarrApiFetch(`members/${memberId}/subscriptions`);
	const results = (await res.json()) as RawSubscriptionRecord[];
	return results
		.map((r) => ({
			id: Number(r.rowid ?? r.id),
			start: parseDolibarrDate(r.dateh),
			end: parseDolibarrDate(r.datef),
			amount: Number(r.amount ?? 0)
		}))
		.sort((a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0));
}

export interface DolibarrMemberType {
	id: number;
	label: string;
	subscriptionRequired: boolean;
}

interface RawMemberTypeRecord {
	id: string | number;
	label: string;
	subscription: string | number;
}

// Les types d'adhérent changent rarement — un cache d'une heure évite de re-interroger Dolibarr
// à chaque calcul de statut sans risquer une staleness gênante.
const TYPES_TTL_MS = 60 * 60_000;
let typesCache: { types: DolibarrMemberType[]; expiresAt: number } | null = null;

export async function getMemberTypes(): Promise<DolibarrMemberType[]> {
	if (typesCache && typesCache.expiresAt > Date.now()) {
		return typesCache.types;
	}

	const res = await dolibarrApiFetch('members/types');
	const results = (await res.json()) as RawMemberTypeRecord[];
	const types = results.map((t) => ({
		id: Number(t.id),
		label: t.label,
		subscriptionRequired: String(t.subscription) === '1'
	}));

	typesCache = { types, expiresAt: Date.now() + TYPES_TTL_MS };
	return types;
}

// Dérive le statut à partir d'un membre déjà chargé + de la liste des types — évite un second
// appel `getMemberByEmail` quand l'appelant a déjà le membre sous la main (ex: la page /cotisation,
// qui a aussi besoin de l'historique des souscriptions).
export function deriveCotisationStatus(
	member: DolibarrMember,
	types: DolibarrMemberType[]
): CotisationStatus {
	const exemptedTypeIds = new Set(types.filter((t) => !t.subscriptionRequired).map((t) => t.id));
	if (member.typeid !== null && exemptedTypeIds.has(member.typeid)) {
		return 'non_applicable';
	}

	if (member.statut === -1) return 'en_attente'; // brouillon, pas encore validé
	if (member.statut === 0) return 'expiree'; // résilié

	const datefin = parseDolibarrDate(member.datefin);
	if (!datefin) return 'en_attente'; // validé, aucune cotisation reçue encore

	return datefin.getTime() >= Date.now() ? 'a_jour' : 'expiree';
}

export async function getCotisationStatus(email: string): Promise<CotisationStatus | null> {
	const member = await getMemberByEmail(email);
	if (!member) return null;

	const types = await getMemberTypes();
	return deriveCotisationStatus(member, types);
}
