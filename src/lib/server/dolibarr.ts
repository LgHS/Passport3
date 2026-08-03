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
	statut: number; // 1 = validé, 0 = brouillon, -1 = résilié
	datefin: string | number | null; // épochs Unix OU date ISO selon l'instance — voir parseDolibarrDate()
	typeid: number | null;
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
}

// `fk_adherent_type` est le nom de colonne réel en base ; `typeid`/`type_id` sont des alias vus
// exposés par l'API selon la version. Ordre de priorité confirmé empiriquement contre l'instance
// LgHS (voir loic-local-dev/test_coti.sh) : fk_adherent_type d'abord.
function resolveTypeId(record: RawMemberRecord): number | null {
	const raw = record.fk_adherent_type ?? record.typeid ?? record.type_id;
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
		typeid: resolveTypeId(record)
	};
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

	if (member.statut === 0) return 'en_attente'; // brouillon, pas encore validé
	if (member.statut === -1) return 'expiree'; // résilié

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
