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

// Un trou est un mois *calendaire*, pas un instant : `start`/`end` sont épinglés à minuit UTC le 1er
// et le dernier jour du mois. Ils doivent donc être lus et affichés en UTC — interprétés en heure
// locale, un trou de janvier glisse au 31/12 (et sur la page de l'année précédente) pour tout
// lecteur à l'ouest de Greenwich.
export interface CotisationGap {
	start: Date;
	end: Date;
}

// Les cotisations LgHS s'enchaînent mois par mois — la fin de l'une tombe systématiquement la
// veille (ou le jour même) du début de la suivante (ex: fin 30/01 -> début 31/01). Un écart de
// plus d'un jour entre deux souscriptions consécutives ne peut donc être qu'une (ou plusieurs)
// cotisation(s) manquante(s), jamais un simple artefact de bornes.
//
// Les deux usages de la constante sont volontairement complémentaires : la fusion accepte
// `start <= end + tolérance`, la détection exige `start - end > tolérance`. Aucun intervalle ne peut
// donc échapper aux deux, ni être compté deux fois.
//
// Effet de bord bénin : au passage à l'heure d'hiver, un "jour" dure 25 h et franchit la tolérance,
// donc la branche "trou" se déclenche. Le filtre du 15 (voir missingMonthsInGap) ne trouve alors
// aucun mois entier manquant et renvoie une liste vide — rien à corriger de ce côté.
const ADJACENCY_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// Passé ce nombre de mois sans renouvellement, le membre est considéré comme parti plutôt que
// simplement en retard. La constante sert deux fois : elle plafonne les lignes "Non perçu" ajoutées
// pour un trou en cours (au-delà, le statut "Cotisation expirée" porte le message tout seul, plutôt
// que d'accumuler des lignes indéfiniment) et fixe le seuil de bascule de `isInactive`. Les deux
// doivent rester cohérents avec le texte affiché côté page ("Après 3 mois sans cotisation...").
const TRAILING_GAP_MONTHS = 3;

// Décale une date de N mois en UTC. `setUTCMonth` normalise les débordements de quantième : 31/01
// + 3 mois donne 01/05, pas un "31/04" inexistant. Sur une fin de mois — le cas courant ici, les
// cotisations LgHS s'arrêtant en fin de mois — le seuil tombe donc un jour après l'anniversaire
// exact. C'est dans le sens généreux (membre marqué inactif plus tard, jamais plus tôt), on s'en
// accommode plutôt que d'ajouter une logique de clamp.
function addUTCMonths(date: Date, months: number): Date {
	const shifted = new Date(date.getTime());
	shifted.setUTCMonth(shifted.getUTCMonth() + months);
	return shifted;
}

// Un trou peut s'étaler sur plusieurs mois (ex: 4 mois sans cotisation) — on le découpe en un
// CotisationGap par mois calendaire manquant plutôt que de renvoyer une seule ligne fusionnée, sinon
// des mois entiers restent invisibles dans le tableau alors qu'ils n'ont bien reçu aucune cotisation.
//
// Critère : un mois est manquant si son 15 tombe dans l'intervalle non couvert (prevEnd, nextStart).
// Le choix du 15 n'est pas arbitraire, il encode la convention LgHS "une cotisation [fin de M-1 ->
// fin de M] paie le mois M". Exemple : cotisations [31/01 -> 28/02] puis [31/03 -> 30/04], donc un
// trou (28/02, 31/03) — le 15/02 est hors intervalle (février est bien payé par la première), le
// 15/03 dedans, seul mars est signalé. C'est le résultat attendu.
//
// Limite connue : sur des bornes non alignées sur les fins de mois, le critère devient approximatif
// dans les deux sens. Un renouvellement en retard du 10/03 au 20/03 marque mars entier "Non perçu"
// alors qu'il est payé aux deux tiers ; à l'inverse un trou du 20/03 au 10/04 (trois semaines) ne
// produit aucune ligne, aucun 15 n'y tombant. Tant que Dolibarr sort des bornes de fin de mois le
// cas ne se présente pas — à revoir si ça change.
//
// Toutes les dates produites sont en UTC (voir CotisationGap). `Date.UTC(y, m + 1, 0)` désigne le
// jour 0 du mois suivant, c.-à-d. le dernier jour du mois courant : mois courts et années
// bissextiles sont gérés par le moteur de dates, sans table de longueurs. Même mécanique pour le
// curseur, où `m + 1 === 12` bascule proprement sur janvier de l'année suivante.
function missingMonthsInGap(prevEnd: Date, nextStart: Date): CotisationGap[] {
	const months: CotisationGap[] = [];
	let cursor = new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), 1));
	const lastMonth = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth(), 1));

	while (cursor.getTime() <= lastMonth.getTime()) {
		const year = cursor.getUTCFullYear();
		const month = cursor.getUTCMonth();
		const midpoint = new Date(Date.UTC(year, month, 15));
		if (midpoint.getTime() > prevEnd.getTime() && midpoint.getTime() < nextStart.getTime()) {
			months.push({
				start: new Date(Date.UTC(year, month, 1)),
				end: new Date(Date.UTC(year, month + 1, 0))
			});
		}
		cursor = new Date(Date.UTC(year, month + 1, 1));
	}

	return months;
}

export interface CotisationGapResult {
	gaps: CotisationGap[];
	// True once the ongoing lapse has lasted TRAILING_GAP_MONTHS — measured as elapsed time since
	// coverage ended, not as a count of gap rows (see detectCotisationGaps for why the two differ).
	// Only the trailing lapse counts: interior gaps were settled by a later renewal, so they say
	// nothing about where the member stands today.
	isInactive: boolean;
}

export function detectCotisationGaps(
	subscriptions: DolibarrSubscription[],
	now: Date = new Date()
): CotisationGapResult {
	// Une souscription à laquelle il manque une borne ne délimite aucune période de couverture : on
	// ne peut ni la fusionner ni s'en servir pour situer un trou, donc elle est écartée d'office
	// (elle reste affichée dans le tableau, la page la traite à part).
	const covered = subscriptions
		.filter((s): s is DolibarrSubscription & { start: Date; end: Date } => s.start !== null && s.end !== null)
		.sort((a, b) => a.start.getTime() - b.start.getTime());

	// Fusionne les souscriptions adjacentes ou qui se chevauchent en plages de couverture continues,
	// pour que les trous se lisent entre ces plages et non entre deux cotisations mensuelles qui se
	// suivent normalement. Le tri par date de début ci-dessus est ce qui rend le balayage en une
	// passe correct. `sub.end > last.end` traite le cas d'une souscription entièrement contenue dans
	// la précédente (régularisation, doublon) : elle ne doit pas raccourcir la plage.
	const merged: { start: Date; end: Date }[] = [];
	for (const sub of covered) {
		const last = merged[merged.length - 1];
		if (last && sub.start.getTime() <= last.end.getTime() + ADJACENCY_TOLERANCE_MS) {
			if (sub.end.getTime() > last.end.getTime()) last.end = sub.end;
		} else {
			merged.push({ start: sub.start, end: sub.end });
		}
	}

	// Trous internes : déjà refermés par un renouvellement ultérieur, donc listés intégralement (pas
	// de plafond ici, contrairement au trou en cours plus bas — leur étendue est connue et finie).
	const gaps: CotisationGap[] = [];
	for (let i = 1; i < merged.length; i++) {
		const prevEnd = merged[i - 1].end;
		const nextStart = merged[i].start;
		if (nextStart.getTime() - prevEnd.getTime() > ADJACENCY_TOLERANCE_MS) {
			gaps.push(...missingMonthsInGap(prevEnd, nextStart));
		}
	}

	// Trou en cours (aucun renouvellement à ce jour) : son étendue n'est pas bornée par une
	// souscription suivante mais par `now`, et grandit indéfiniment. On n'en garde donc que les
	// TRAILING_GAP_MONTHS mois les plus *récents* — au-delà, le membre est considéré abandonné plutôt
	// qu'en retard, et le statut "expirée" suffit sans lignes supplémentaires. On coupe par la fin et
	// non par le début : quelqu'un parti depuis huit mois doit voir les mois qui précèdent
	// aujourd'hui, pas trois mois vieux d'un an suivis d'un silence inexpliqué.
	let isInactive = false;
	const lastCovered = merged[merged.length - 1];
	// La comparaison écarte au passage une cotisation courant dans le futur (différence négative) :
	// pas de trou en cours, donc rien à signaler ni à faire basculer.
	if (lastCovered && now.getTime() - lastCovered.end.getTime() > ADJACENCY_TOLERANCE_MS) {
		gaps.push(...missingMonthsInGap(lastCovered.end, now).slice(-TRAILING_GAP_MONTHS));
		// Seuil mesuré en temps écoulé, et non sur le nombre de lignes ajoutées juste au-dessus :
		// celles-ci comptent le mois en cours dès son 15, ce qui faisait basculer en "inactif" après
		// ~2 mois et 20 jours alors que la page annonce 3 mois. Couverture finie le 31/01 : inactif au
		// 01/05 (cf. addUTCMonths pour le jour de décalage), plus au 20/04.
		isInactive = now.getTime() >= addUTCMonths(lastCovered.end, TRAILING_GAP_MONTHS).getTime();
	}

	return { gaps, isInactive };
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
