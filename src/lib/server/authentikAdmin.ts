import { requireEnv } from '$lib/server/env';
import { getCachedProfile, setCachedProfile } from '$lib/server/profileCache';
import { getMattermostUsername, buildMattermostDmUrl } from '$lib/server/mattermost';
import type { EmergencyContact, ProfileAttributeField, UserProfile } from '$lib/types';

export type { EmergencyContact, ProfileAttributeField, UserProfile };

// Whitelist that also acts as the merge boundary for updateUserProfile: only these keys are
// ever read from or written into the user's Authentik `attributes` blob.
export const PROFILE_ATTRIBUTE_FIELDS: ProfileAttributeField[] = [
	{ key: 'phoneNumber', label: 'Téléphone (format: 32470000000)', required: true },
	{ key: 'street', label: 'Rue & Numéro', required: true },
	{ key: 'postal_code', label: 'Code postal', required: true },
	{ key: 'locality', label: 'Localité', required: true },
	{ key: 'country', label: 'Pays', required: true },
	{ key: 'birthday', label: 'Date de naissance', required: false },
	// Boolean stored as the string "true"/"false" (see validateProfileSubmission's special-case
	// normalization) rather than a free value. Checked by default in the UI (ProfileForm.svelte) —
	// confirmed with the user despite this being a public disclosure (unlike the opt-out-by-default
	// NotificationPreferences, which is a private DM setting) — a never-set value reads as "on",
	// only an explicit "false" (member unchecked and saved) turns it off.
	{ key: 'birthdayAnnounce', label: 'Annonce anniversaire sur Mattermost', required: false },
	// Réseaux sociaux — optionnels, affichés dans un panneau replié sur /profile ("Divers
	// (facultatifs)"). D'autres réseaux pourront suivre ce même schéma (key + label +
	// required: false, plus un validateur dédié dans profileValidation.ts si le format doit être
	// vérifié).
	{ key: 'signal', label: 'Signal', required: false },
	{ key: 'telegram', label: 'Telegram', required: false },
	{ key: 'discord', label: 'Discord', required: false },
	{ key: 'matrix', label: 'Matrix', required: false }
];

interface AuthentikUserRecord {
	pk: number;
	username: string;
	name: string;
	email: string;
	avatar: string;
	attributes: Record<string, unknown>;
}

function authentikOrigin(): string {
	return new URL(requireEnv('AUTHENTIK_ISSUER')).origin;
}

function apiBase(): string {
	return `${authentikOrigin()}/api/v3/`;
}

const FETCH_TIMEOUT_MS = 5_000;

// Thrown when the Authentik admin API is unreachable or erroring server-side (down, restarting,
// network blip) — as opposed to a genuinely invalid request (bad payload, 404, etc.). Mirrors
// OidcUnavailableError in authentik.ts, so an outage here can be told apart from an application
// bug the same way that one already is.
export class AuthentikUnavailableError extends Error {}

export function getAuthentikAccountUrl(): string {
	return `${authentikOrigin()}/if/user/`;
}

// Generic fallback: Authentik's own hosted user-settings SPA, credentials page. Enrolling a new
// TOTP/static device has to happen there — it runs Authentik's flow executor in the member's own
// Authentik session, which our privileged service token has no way to drive on their behalf.
function authentikCredentialsSettingsUrl(): string {
	return `${authentikOrigin()}/if/user/#/settings;${encodeURIComponent(JSON.stringify({ page: 'page-credentials' }))}`;
}

interface StageRecord {
	pk: string;
}

async function firstStagePk(path: string): Promise<string | null> {
	const res = await authentikApiFetch(path);
	const data = (await res.json()) as { results: StageRecord[] };
	return data.results[0]?.pk ?? null;
}

// Direct links into Authentik's enrollment flow for a specific stage (skips having to click
// through Authentik's own "Enroll" dropdown) — falls back to the generic credentials settings
// page if no such stage is configured on this instance.
//
// `next` has to stay a path on Authentik's own origin: Authentik validates it server-side and
// rejects anything else ("URL suivante invalide") — confirmed by trying an absolute Passport3
// URL, which Authentik refused. So the browser lands back on Authentik's settings page, not ours.
export async function getMfaEnrollUrls(): Promise<{ totp: string; static: string }> {
	const fallback = authentikCredentialsSettingsUrl();
	const next = encodeURIComponent('/if/user/#/settings;' + JSON.stringify({ page: 'page-credentials' }));

	const [totpPk, staticPk] = await Promise.all([
		firstStagePk('stages/authenticator/totp/'),
		firstStagePk('stages/authenticator/static/')
	]);

	return {
		totp: totpPk ? `${authentikOrigin()}/flows/-/configure/${totpPk}/?next=${next}` : fallback,
		static: staticPk ? `${authentikOrigin()}/flows/-/configure/${staticPk}/?next=${next}` : fallback
	};
}

async function authentikApiFetch(path: string, init?: RequestInit): Promise<Response> {
	// Outside the try below: a missing/invalid AUTHENTIK_ISSUER or AUTHENTIK_API_TOKEN is a
	// persistent configuration error, not an outage.
	const url = new URL(path, apiBase());
	const token = requireEnv('AUTHENTIK_API_TOKEN');

	let res: Response;
	let body: string | undefined;
	try {
		res = await fetch(url, {
			...init,
			// NB: placed after `...init`, so it silently wins over a caller-supplied `init.signal`
			// rather than the other way round. Harmless today (no caller passes one — 32 call
			// sites, none with a signal), but worth revisiting if one ever needs to.
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				...init?.headers
			}
		});
		// Reading the error body under the same try: the AbortSignal above stays armed for the
		// full exchange, not just until headers arrive, so a body that's still streaming in at
		// T+5s must be caught here too — otherwise a slow-body timeout would surface as a raw
		// TimeoutError instead of AuthentikUnavailableError, defeating the point of this function.
		if (!res.ok) {
			body = await res.text();
		}
	} catch (err) {
		// Network failure, or the timeout above firing on either the connection or the body read
		// (AbortSignal.timeout rejects with a TimeoutError DOMException either way) — Authentik
		// never gave us a complete answer.
		throw new AuthentikUnavailableError(`Authentik API request to ${path} timed out or failed: ${err}`, {
			cause: err
		});
	}

	if (!res.ok) {
		// >=500 is Authentik's own server erroring out (down/misconfigured/overloaded) — treat as
		// an outage. A 4xx is a genuine request problem and should stay a hard error.
		if (res.status >= 500) {
			throw new AuthentikUnavailableError(`Authentik API request to ${path} failed (${res.status}): ${body}`);
		}
		throw new Error(`Authentik API request to ${path} failed (${res.status}): ${body}`);
	}

	return res;
}

function pickAttributes(source: Record<string, unknown>): Record<string, string> {
	const picked: Record<string, string> = {};
	for (const { key } of PROFILE_ATTRIBUTE_FIELDS) {
		const value = source[key];
		if (typeof value === 'string') {
			picked[key] = value;
		}
	}
	return picked;
}

export async function getUserProfile(pk: number): Promise<UserProfile> {
	const cached = getCachedProfile(pk);
	if (cached) return cached;

	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	const profile: UserProfile = {
		username: user.username,
		name: user.name,
		email: user.email,
		avatar: user.avatar || null,
		attributes: pickAttributes(user.attributes)
	};

	setCachedProfile(pk, profile);
	return profile;
}

export interface ProfileMutationResult {
	// Whether anything actually changed (and was written), so callers can skip telling the user
	// "saved" when they just re-submitted the same values, and skip logging a no-op audit event.
	changed: boolean;
	// Sourced from the same read used for the merge/PATCH below, not from getUserProfile()'s
	// cache — a caller reading its own "before" via getUserProfile() first can get a stale value
	// if the cache hasn't expired yet, which would make the audit trail lie about what changed and
	// when. See feedback_recheck-must-verify-usage-not-just-types and PR #45's review.
	before: { name: string; attributes: Record<string, string> };
	after: { name: string; attributes: Record<string, string> };
}

export async function updateUserProfile(
	pk: number,
	update: { name: string; attributes: Record<string, string> }
): Promise<ProfileMutationResult> {
	// Read-merge-write: `attributes` is an opaque JSON blob on the Authentik side, and a PATCH
	// replaces it wholesale — so we must merge into the current value rather than send ours alone,
	// or we'd silently wipe out attributes this app doesn't know about.
	const current = await authentikApiFetch(`core/users/${pk}/`);
	const currentUser = (await current.json()) as AuthentikUserRecord;

	const mergedAttributes: Record<string, unknown> = { ...currentUser.attributes };
	for (const { key } of PROFILE_ATTRIBUTE_FIELDS) {
		if (key in update.attributes) {
			mergedAttributes[key] = update.attributes[key];
		}
	}

	const before = { name: currentUser.name, attributes: pickAttributes(currentUser.attributes) };
	const after = { name: update.name, attributes: pickAttributes(mergedAttributes) };

	const nameChanged = update.name !== currentUser.name;
	const attributesChanged = PROFILE_ATTRIBUTE_FIELDS.some(
		({ key }) => (currentUser.attributes[key] ?? '') !== (mergedAttributes[key] ?? '')
	);

	if (!nameChanged && !attributesChanged) {
		return { changed: false, before, after: before };
	}

	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({ name: update.name, attributes: mergedAttributes })
	});

	// We already have everything needed to know the resulting profile — cache it directly
	// instead of just evicting, so the very next read (e.g. after invalidateAll()) is a hit
	// with the correct new data rather than a stale one or an avoidable extra round-trip.
	setCachedProfile(pk, {
		username: currentUser.username,
		name: update.name,
		email: currentUser.email,
		avatar: currentUser.avatar || null,
		attributes: pickAttributes(mergedAttributes)
	});

	return { changed: true, before, after };
}

// Not part of PROFILE_ATTRIBUTE_FIELDS: that whitelist is specifically the merge boundary for
// the member-editable profile form, whereas rfid_uid is provisioned by us and never user-entered.
const RFID_UID_ATTRIBUTE = 'rfid_uid';

export interface UserGroup {
	name: string;
	isSuperuser: boolean;
	// From the group's own `attributes.notes`, if set (Directory -> Groups -> [group] -> Edit ->
	// Attributes, in Authentik's admin UI). Most groups won't have one.
	note: string | null;
}

interface AuthentikUserRecordWithGroups extends AuthentikUserRecord {
	groups_obj: { name: string; is_superuser: boolean; attributes: Record<string, unknown> }[];
}

// Full group objects (name, is_superuser, attributes) — unlike the plain group name list already
// carried in the member's own OIDC session (`profile` scope's `groups` claim, group names only),
// this needs the privileged service token: group attributes are never exposed via the ID token.
export async function getUserGroups(pk: number): Promise<UserGroup[]> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecordWithGroups;
	// Defensive: this is a cast, not a runtime-validated schema — don't assume the field is always
	// present in whatever shape a future Authentik version (or a differently-scoped token) returns.
	return (user.groups_obj ?? []).map((g) => {
		const note = g.attributes.notes;
		return {
			name: g.name,
			isSuperuser: g.is_superuser,
			note: typeof note === 'string' && note.trim() ? note : null
		};
	});
}

export async function getRfidUid(pk: number): Promise<string | null> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	const value = user.attributes[RFID_UID_ATTRIBUTE];
	return typeof value === 'string' && value ? value : null;
}

// Read-merge-write, same reasoning as updateUserProfile: `attributes` is replaced wholesale by a
// PATCH, so the rest of the blob must be preserved rather than overwritten.
export async function regenerateRfidUid(pk: number): Promise<string> {
	const current = await authentikApiFetch(`core/users/${pk}/`);
	const currentUser = (await current.json()) as AuthentikUserRecord;

	const uuid = crypto.randomUUID();
	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({ attributes: { ...currentUser.attributes, [RFID_UID_ATTRIBUTE]: uuid } })
	});

	return uuid;
}

// Not part of PROFILE_ATTRIBUTE_FIELDS, same reasoning as rfid_uid: only ever set by the GitHub
// OAuth callback after verifying the member really owns that account — never hand-typed, so it
// can't be part of the plain profile form's merge boundary.
const GITHUB_USERNAME_ATTRIBUTE = 'github_username';

export async function getGithubUsername(pk: number): Promise<string | null> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	const value = user.attributes[GITHUB_USERNAME_ATTRIBUTE];
	return typeof value === 'string' && value ? value : null;
}

// Read-merge-write, same reasoning as updateUserProfile/regenerateRfidUid.
export async function setGithubUsername(pk: number, username: string): Promise<void> {
	const current = await authentikApiFetch(`core/users/${pk}/`);
	const currentUser = (await current.json()) as AuthentikUserRecord;
	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({
			attributes: { ...currentUser.attributes, [GITHUB_USERNAME_ATTRIBUTE]: username }
		})
	});
}

export interface TrombinoscopeOptin {
	visible: boolean;
	showAvatar: boolean;
	showChat: boolean;
	showFirstname: boolean;
	showLastname: boolean;
	showMail: boolean;
	showPhone: boolean;
}

const TROMBINOSCOPE_DEFAULTS: TrombinoscopeOptin = {
	visible: false,
	// showAvatar/showChat default to true, unlike every other field here — a deliberate choice,
	// applies retroactively to members who opted into the trombinoscope before these fields
	// existed (their stored attribute has no such key, so this default fills it in on next read
	// either way).
	showAvatar: true,
	showChat: true,
	showFirstname: false,
	showLastname: false,
	showMail: false,
	showPhone: false
};

// Not part of PROFILE_ATTRIBUTE_FIELDS, same reasoning as rfid_uid: this isn't a plain string
// field edited through the generic profile form, it's a structured on/off blob with its own form.
const TROMBINOSCOPE_ATTRIBUTE = 'trombinoscope';

// The `trombinoscope` attribute also holds `tag`/`tagc` (see TrombinoscopeTag below) in that same
// object — a plain spread of the raw value over TROMBINOSCOPE_DEFAULTS would silently carry those
// along too despite the TrombinoscopeOptin type claiming only these 7 fields. That bit both
// getTrombinoscopeOptin() and the audit trail below: a member merely toggling their visibility got
// tag/tagc showing up as "removed" in the diff, since `after` (a clean TrombinoscopeOptin) never
// had them in the first place. Whitelisting explicitly, same spirit as pickAttributes() above.
function pickTrombinoscopeOptin(raw: unknown): TrombinoscopeOptin {
	const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	const optin = { ...TROMBINOSCOPE_DEFAULTS };
	for (const key of Object.keys(TROMBINOSCOPE_DEFAULTS) as (keyof TrombinoscopeOptin)[]) {
		if (typeof source[key] === 'boolean') {
			optin[key] = source[key] as boolean;
		}
	}
	return optin;
}

export async function getTrombinoscopeOptin(pk: number): Promise<TrombinoscopeOptin> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	return pickTrombinoscopeOptin(user.attributes[TROMBINOSCOPE_ATTRIBUTE]);
}

// Unchecked checkboxes simply aren't present in FormData — absence means false, same convention
// as every other checkbox form in this app. Shared between the member-facing /trombinoscope form
// and the admin edit form, which submits the same field names on another member's behalf.
export function optinFromFormData(formData: FormData): TrombinoscopeOptin {
	return {
		visible: formData.has('visible'),
		showAvatar: formData.has('showAvatar'),
		showChat: formData.has('showChat'),
		showFirstname: formData.has('showFirstname'),
		showLastname: formData.has('showLastname'),
		showMail: formData.has('showMail'),
		showPhone: formData.has('showPhone')
	};
}

export interface TrombinoscopeOptinMutationResult {
	// Sourced from this same call's own read, not a separate getTrombinoscopeOptin() call made by
	// the caller beforehand — two independent reads leave a window where the value could change
	// between them, which would make the audit trail's "before" not actually be the state this
	// PATCH was based on. See ProfileMutationResult above and PR #45's review.
	before: TrombinoscopeOptin;
	after: TrombinoscopeOptin;
}

// Read-merge-write, same reasoning as updateUserProfile/regenerateRfidUid — but two levels deep
// here: not just `attributes` as a whole, but also the `trombinoscope` value inside it. Fields
// like `tag`/`tagc` (admin-assigned role labels) live in that same object outside of what this
// member-facing form ever submits — replacing it wholesale would silently wipe them out the next
// time a member just toggles their own visibility.
export async function updateTrombinoscopeOptin(
	pk: number,
	optin: TrombinoscopeOptin
): Promise<TrombinoscopeOptinMutationResult> {
	const current = await authentikApiFetch(`core/users/${pk}/`);
	const currentUser = (await current.json()) as AuthentikUserRecord;
	const currentTrombinoscope = currentUser.attributes[TROMBINOSCOPE_ATTRIBUTE];
	const currentTrombinoscopeObj =
		typeof currentTrombinoscope === 'object' && currentTrombinoscope !== null
			? currentTrombinoscope
			: {};
	const before = pickTrombinoscopeOptin(currentTrombinoscope);

	// Hiding the profile must only flip `visible`: the member-facing form removes the other
	// checkboxes from the DOM entirely while hidden (see /trombinoscope's
	// `{#if wantsToBeDisplayed}`), so an absent checkbox in that submission means "not shown right
	// now", not "turn this off for good". Applying it as a real change would silently wipe every
	// other preference the moment someone hides their profile, resetting them all by the time they
	// show it again.
	const mergedTrombinoscope = optin.visible
		? { ...currentTrombinoscopeObj, ...optin }
		: { ...currentTrombinoscopeObj, visible: false };

	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({
			attributes: { ...currentUser.attributes, [TROMBINOSCOPE_ATTRIBUTE]: mergedTrombinoscope }
		})
	});

	return { before, after: pickTrombinoscopeOptin(mergedTrombinoscope) };
}

export interface NotificationPreferences {
	// Opt-out, not opt-in — the mattermostBot webhook module (see src/lib/server/mattermostBot.ts)
	// is expected to notify by default, a member has to explicitly turn it off. Confirmed with the
	// user rather than assumed, since every other opt-in on this app (trombinoscope, sessions,
	// etc.) defaults the other way.
	mattermostDm: boolean;
}

const NOTIFICATION_PREFERENCES_DEFAULTS: NotificationPreferences = {
	mattermostDm: true
};

// Own attribute, not folded into `trombinoscope` — unrelated concern (delivery preference, not
// directory visibility).
const NOTIFICATION_PREFERENCES_ATTRIBUTE = 'notificationPreferences';

export async function getNotificationPreferences(pk: number): Promise<NotificationPreferences> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	const value = user.attributes[NOTIFICATION_PREFERENCES_ATTRIBUTE];
	return typeof value === 'object' && value !== null
		? { ...NOTIFICATION_PREFERENCES_DEFAULTS, ...(value as Partial<NotificationPreferences>) }
		: NOTIFICATION_PREFERENCES_DEFAULTS;
}

// Read-merge-write, same reasoning as updateTrombinoscopeOptin.
export async function updateNotificationPreferences(
	pk: number,
	prefs: NotificationPreferences
): Promise<void> {
	const current = await authentikApiFetch(`core/users/${pk}/`);
	const currentUser = (await current.json()) as AuthentikUserRecord;

	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({
			attributes: { ...currentUser.attributes, [NOTIFICATION_PREFERENCES_ATTRIBUTE]: prefs }
		})
	});
}

// `tag`/`tagc` — an admin-assigned role label (e.g. "Prés. CA") and its badge color — live in the
// same `trombinoscope` attribute as TrombinoscopeOptin, but are kept in a separate type: they're
// admin-only fields, never part of what the member-facing /trombinoscope form reads or submits.
export interface TrombinoscopeTag {
	tag: string | null;
	tagColor: string | null;
}

export async function getTrombinoscopeTag(pk: number): Promise<TrombinoscopeTag> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	const raw = user.attributes[TROMBINOSCOPE_ATTRIBUTE];
	const rawTrombi = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	const tagValue = rawTrombi.tag;
	const tagColorValue = rawTrombi.tagc;
	return {
		tag: typeof tagValue === 'string' && tagValue.trim() ? tagValue : null,
		tagColor:
			typeof tagColorValue === 'string' && HEX_COLOR_RE.test(tagColorValue) ? tagColorValue : null
	};
}

export interface TrombinoscopeTagMutationResult {
	// Same freshness reasoning as TrombinoscopeOptinMutationResult above.
	before: TrombinoscopeTag;
	after: TrombinoscopeTag;
}

// Same read-merge-write shape as updateTrombinoscopeOptin, kept as its own function rather than
// folded into it: the two are edited from different forms (this one only exists in the admin UI)
// and have independent validation (tagColor is a hex string, not a checkbox).
export async function updateTrombinoscopeTag(
	pk: number,
	tag: TrombinoscopeTag
): Promise<TrombinoscopeTagMutationResult> {
	const current = await authentikApiFetch(`core/users/${pk}/`);
	const currentUser = (await current.json()) as AuthentikUserRecord;
	const currentTrombinoscope = currentUser.attributes[TROMBINOSCOPE_ATTRIBUTE];
	const rawTrombi =
		typeof currentTrombinoscope === 'object' && currentTrombinoscope !== null
			? (currentTrombinoscope as Record<string, unknown>)
			: {};
	const beforeTagValue = rawTrombi.tag;
	const beforeTagColorValue = rawTrombi.tagc;
	const before: TrombinoscopeTag = {
		tag: typeof beforeTagValue === 'string' && beforeTagValue.trim() ? beforeTagValue : null,
		tagColor:
			typeof beforeTagColorValue === 'string' && HEX_COLOR_RE.test(beforeTagColorValue)
				? beforeTagColorValue
				: null
	};
	const mergedTrombinoscope = {
		...rawTrombi,
		tag: tag.tag ?? '',
		tagc: tag.tagColor ?? ''
	};

	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({
			attributes: { ...currentUser.attributes, [TROMBINOSCOPE_ATTRIBUTE]: mergedTrombinoscope }
		})
	});

	return { before, after: tag };
}

// One-directional, sensitive data: a member records who to contact in case of an accident at the
// hackerspace, only ever read by an admin (or the member themselves) — never opt-in-public, never
// shown in the trombinoscope. A structured list rather than a single string, so it lives in its
// own attribute outside PROFILE_ATTRIBUTE_FIELDS, same reasoning as `trombinoscope`.
const EMERGENCY_CONTACTS_ATTRIBUTE = 'emergencyContacts';
export const MAX_EMERGENCY_CONTACTS = 3;

function isEmergencyContact(value: unknown): value is EmergencyContact {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as EmergencyContact).name === 'string' &&
		typeof (value as EmergencyContact).phone === 'string'
	);
}

export async function getEmergencyContacts(pk: number): Promise<EmergencyContact[]> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	const value = user.attributes[EMERGENCY_CONTACTS_ATTRIBUTE];
	if (!Array.isArray(value)) return [];
	return value
		.filter(isEmergencyContact)
		.slice(0, MAX_EMERGENCY_CONTACTS)
		.map((c) => ({ name: c.name, phone: c.phone, relation: typeof c.relation === 'string' ? c.relation : '' }));
}

export interface EmergencyContactsMutationResult {
	// Same freshness reasoning as ProfileMutationResult above — also incidentally more reliable
	// than the previous caller-side getEmergencyContacts(pk).catch(() => null): that read could
	// fail independently of the mutation and log a misleading `null` "before", whereas this one
	// can't fail without the mutation itself failing too.
	before: EmergencyContact[];
	after: EmergencyContact[];
}

// Read-merge-write, same reasoning as updateUserProfile: `attributes` is replaced wholesale by a
// PATCH, so the rest of the blob must be preserved rather than overwritten.
export async function updateEmergencyContacts(
	pk: number,
	contacts: EmergencyContact[]
): Promise<EmergencyContactsMutationResult> {
	const current = await authentikApiFetch(`core/users/${pk}/`);
	const currentUser = (await current.json()) as AuthentikUserRecord;
	const beforeValue = currentUser.attributes[EMERGENCY_CONTACTS_ATTRIBUTE];
	const before = Array.isArray(beforeValue)
		? beforeValue
				.filter(isEmergencyContact)
				.slice(0, MAX_EMERGENCY_CONTACTS)
				.map((c) => ({
					name: c.name,
					phone: c.phone,
					relation: typeof c.relation === 'string' ? c.relation : ''
				}))
		: [];

	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({
			attributes: { ...currentUser.attributes, [EMERGENCY_CONTACTS_ATTRIBUTE]: contacts }
		})
	});

	return { before, after: contacts };
}

export interface AdminUserSummary {
	pk: number;
	username: string;
	name: string;
	email: string;
	is_active: boolean;
}

// Not real members: Authentik's own outpost/internal service accounts, plus the break-glass
// admin account, which shouldn't clutter the member list.
const EXCLUDED_USERNAMES = new Set(['lghsadm','akadmin']);
const EXCLUDED_TYPES = new Set(['service_account', 'internal_service_account']);

// v1 simplification: single page, no pager UI — fine for a hackerspace-sized member list.
export async function listUsers(): Promise<AdminUserSummary[]> {
	const res = await authentikApiFetch('core/users/?page_size=500');
	const data = (await res.json()) as {
		results: (AuthentikUserRecord & { is_active: boolean; type: string })[];
	};
	return data.results
		.filter((u) => !EXCLUDED_USERNAMES.has(u.username) && !EXCLUDED_TYPES.has(u.type))
		.map(({ pk, username, name, email, is_active }) => ({
			pk,
			username,
			name,
			email,
			is_active
		}));
}

export interface BirthdayAnnounceMember {
	pk: number;
	email: string;
	// Always "MM-DD" or "YYYY-MM-DD" — see validateBirthday() in profileValidation.ts. Left as the
	// raw string here; matching "is it today" is the caller's job, not this module's.
	birthday: string;
}

// Only members who opted in and actually filled in a birthday — the two are independent fields
// (see PROFILE_ATTRIBUTE_FIELDS above), a member could have one without the other. Same
// active/excluded-account filtering as listDirectoryMembers() — a deactivated or leftover
// service-account attribute set shouldn't keep getting a birthday shout-out.
export async function listBirthdayAnnounceMembers(): Promise<BirthdayAnnounceMember[]> {
	const res = await authentikApiFetch('core/users/?page_size=500');
	const data = (await res.json()) as {
		results: (AuthentikUserRecord & { is_active: boolean; type: string })[];
	};
	return data.results
		.filter(
			(u) =>
				u.is_active &&
				!EXCLUDED_USERNAMES.has(u.username) &&
				!EXCLUDED_TYPES.has(u.type) &&
				u.attributes.birthdayAnnounce === 'true' &&
				!!u.attributes.birthday
		)
		.map((u) => ({ pk: u.pk, email: u.email, birthday: String(u.attributes.birthday) }));
}

export interface DirectoryMember {
	pk: number;
	username: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	phone: string | null;
	avatar: string | null;
	// Admin-assigned role label (e.g. "Trésorier") — lives in the same `trombinoscope` attribute
	// but outside TrombinoscopeOptin since it's not something the member-facing form edits.
	tag: string | null;
	// Hex color without the `#`, validated — null falls back to the default black badge.
	tagColor: string | null;
	// Signal/Telegram/Discord/Matrix, set on /profile (optional fields there). No dedicated
	// trombinoscope opt-in for these: filling them in on an already-optional field *is* the
	// consent, so presence is the only gate — same as tag/tagColor above, just gated by `visible`.
	signal: string | null;
	telegram: string | null;
	discord: string | null;
	matrix: string | null;
	// Gated by TrombinoscopeOptin.showChat (unlike signal/telegram/discord/matrix above) — this
	// isn't member-entered, it's looked up from Mattermost by email, so presence alone can't be the
	// consent signal the way it is for those. null if showChat is off, or no active Mattermost
	// account was found under the member's email.
	mattermostUsername: string | null;
	mattermostDmUrl: string | null;
}

function stringAttr(attributes: Record<string, unknown>, key: string): string | null {
	const value = attributes[key];
	return typeof value === 'string' && value.trim() ? value : null;
}

export const HEX_COLOR_RE = /^[0-9a-fA-F]{6}$/;

// Authentik only has a single `name` field, no first/last split — heuristic split (first token vs
// the rest) so the trombinoscope's separate Prénom/Nom opt-in has something to gate independently.
function splitName(name: string): { firstName: string; lastName: string } {
	const [first, ...rest] = name.trim().split(/\s+/);
	return { firstName: first ?? '', lastName: rest.join(' ') };
}

// The trombinoscope is opt-in and field-granular (see TrombinoscopeOptin): a member who hasn't
// set `visible` is excluded entirely, and only the fields they've individually consented to show
// are ever put on the returned object — filtering happens here, server-side, so a field a member
// chose not to share never reaches the browser in the first place (not just hidden in the UI).
export async function listDirectoryMembers(): Promise<DirectoryMember[]> {
	const res = await authentikApiFetch('core/users/?page_size=500');
	const data = (await res.json()) as {
		results: (AuthentikUserRecord & { is_active: boolean; type: string })[];
	};

	const members = await Promise.all(
		data.results
			.filter(
				(u) => u.is_active && !EXCLUDED_USERNAMES.has(u.username) && !EXCLUDED_TYPES.has(u.type)
			)
			.map(async (u): Promise<DirectoryMember | null> => {
				const raw = u.attributes[TROMBINOSCOPE_ATTRIBUTE];
				const optin: TrombinoscopeOptin =
					typeof raw === 'object' && raw !== null
						? { ...TROMBINOSCOPE_DEFAULTS, ...(raw as Partial<TrombinoscopeOptin>) }
						: TROMBINOSCOPE_DEFAULTS;
				if (!optin.visible) return null;

				const { firstName, lastName } = splitName(u.name);
				const rawTrombi = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
				const tagValue = rawTrombi.tag;
				const tagColorValue = rawTrombi.tagc;

				// Same rationale as the .catch() calls around Authentik/Dolibarr in +layout.server.ts:
				// a transient Mattermost hiccup on a cache-miss shouldn't 500 the entire directory
				// just because one member has "Pseudo Chat" enabled — that member's chat link is
				// simply absent this time, everyone else's data still loads.
				const mattermostUsername =
					optin.showChat && u.email
						? await getMattermostUsername(u.email).catch(() => null)
						: null;

				return {
					pk: u.pk,
					username: u.username,
					firstName: optin.showFirstname ? firstName : null,
					lastName: optin.showLastname ? lastName : null,
					email: optin.showMail ? u.email : null,
					phone:
						optin.showPhone && typeof u.attributes.phoneNumber === 'string'
							? u.attributes.phoneNumber
							: null,
					avatar: optin.showAvatar ? u.avatar || null : null,
					tag: typeof tagValue === 'string' && tagValue.trim() ? tagValue : null,
					tagColor:
						typeof tagColorValue === 'string' && HEX_COLOR_RE.test(tagColorValue)
							? tagColorValue
							: null,
					signal: stringAttr(u.attributes, 'signal'),
					telegram: stringAttr(u.attributes, 'telegram'),
					discord: stringAttr(u.attributes, 'discord'),
					matrix: stringAttr(u.attributes, 'matrix'),
					mattermostUsername,
					mattermostDmUrl: mattermostUsername ? buildMattermostDmUrl(mattermostUsername) : null
				};
			})
	);

	return members.filter((m): m is DirectoryMember => m !== null);
}

interface FlowRecord {
	pk: string;
}

interface InvitationRecord {
	pk: string;
}

// Authentik's invitation `name` is just an admin-facing label/identifier, constrained to
// ^[-a-zA-Z0-9_]+$ — an email doesn't fit that, so derive a readable-but-valid name from it
// (plus a timestamp, since the same person could plausibly be invited more than once).
function invitationNameFromEmail(email: string): string {
	return `${email.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`;
}

export async function createInvitation(opts: {
	email: string;
	singleUse: boolean;
	expiresAt: string;
}): Promise<{ inviteUrl: string }> {
	const slug = requireEnv('AUTHENTIK_ENROLLMENT_FLOW_SLUG');

	const flowRes = await authentikApiFetch(`flows/instances/?slug=${encodeURIComponent(slug)}`);
	const flowData = (await flowRes.json()) as { results: FlowRecord[] };
	const flow = flowData.results[0];
	if (!flow) {
		throw new Error(`No Authentik flow found with slug "${slug}"`);
	}

	const invitationRes = await authentikApiFetch('stages/invitation/invitations/', {
		method: 'POST',
		body: JSON.stringify({
			name: invitationNameFromEmail(opts.email),
			flow: flow.pk,
			single_use: opts.singleUse,
			expires: opts.expiresAt,
			fixed_data: { email: opts.email }
		})
	});
	const invitation = (await invitationRes.json()) as InvitationRecord;

	// Let Authentik send the actual invite email — it already owns SMTP/template config, no
	// need to build our own email sending here.
	//
	// Deliberately NOT passing `template` here: on this Authentik instance (2026.5.6) including
	// it in the request body makes send_email fail with a 405, confirmed by direct testing —
	// the `template` override on this endpoint isn't supported by this version's API yet (it's
	// present in newer/dev Authentik's OpenAPI schema, which is what this was first built
	// against). The custom LGHS template should instead be set as the *default* template on the
	// Email stage bound to the invitation flow, in Authentik's own admin UI — that applies
	// whenever a request (like this one) doesn't override it.
	await authentikApiFetch(`stages/invitation/invitations/${invitation.pk}/send_email/`, {
		method: 'POST',
		body: JSON.stringify({ email_addresses: [opts.email] })
	});

	return {
		inviteUrl: `${authentikOrigin()}/if/flow/${slug}/?itoken=${invitation.pk}`
	};
}

export interface SessionSummary {
	uuid: string;
	current: boolean;
	browser: string;
	os: string;
	location: string | null;
	lastIp: string;
	lastUsed: string;
	expires: string;
}

interface AuthenticatedSessionRecord {
	uuid: string;
	current: boolean;
	user_agent: { string: string; os: { family: string } };
	geo_ip: { city: string | null; country: string | null } | null;
	last_ip: string;
	last_used: string;
	expires: string;
}

function ipToInt(ip: string): number | null {
	const bytes = ip.split('.').map(Number);
	if (bytes.length !== 4 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
		return null;
	}
	return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

// The hackerspace's own LAN sits entirely inside this RFC 1918 block. A session's last_ip landing
// here means it was made on-site — geo-IP lookups never resolve anything useful for a private
// address (Authentik's geo_ip comes back null), so it's shown by name instead of a bare private IP.
const LGHS_LOCAL_NETWORK = ipToInt('172.16.0.0') as number;
const LGHS_LOCAL_MASK = (0xffffffff << (32 - 12)) >>> 0;

function isLghsLocalIp(ip: string): boolean {
	const ipInt = ipToInt(ip);
	return ipInt !== null && (ipInt & LGHS_LOCAL_MASK) === (LGHS_LOCAL_NETWORK & LGHS_LOCAL_MASK);
}

export async function listSessions(username: string): Promise<SessionSummary[]> {
	const res = await authentikApiFetch(
		`core/authenticated_sessions/?user__username=${encodeURIComponent(username)}`
	);
	const data = (await res.json()) as { results: AuthenticatedSessionRecord[] };
	return data.results.map((s) => {
		const geoLocation = s.geo_ip
			? [s.geo_ip.city, s.geo_ip.country].filter(Boolean).join(', ') || null
			: null;
		return {
			uuid: s.uuid,
			current: s.current,
			browser: s.user_agent.string,
			os: s.user_agent.os.family,
			location: geoLocation ?? (isLghsLocalIp(s.last_ip) ? 'Liège Hackerspace' : null),
			lastIp: s.last_ip,
			lastUsed: s.last_used,
			expires: s.expires
		};
	});
}

export async function revokeSession(username: string, uuid: string): Promise<void> {
	// Defense in depth: never delete a session without first confirming it belongs to the
	// member the caller is acting as — a leaked/guessed uuid shouldn't be enough on its own.
	const owned = (await listSessions(username)).some((s) => s.uuid === uuid);
	if (!owned) {
		throw new Error('Session introuvable pour cet utilisateur.');
	}
	await authentikApiFetch(`core/authenticated_sessions/${uuid}/`, { method: 'DELETE' });
}

export interface MfaDevice {
	pk: string;
	name: string;
	type: string;
	created: string;
}

interface DeviceRecord {
	pk: string;
	name: string;
	type: string;
	created: string;
}

// Authentik's device `type` is the Django model label (`app_label.ModelName`) — match on the
// class-name suffix (stable across versions) rather than the app_label prefix, and use the same
// table both to build a friendly label and to route the delete call to the right per-type
// admin endpoint (there's no unified delete — see plan notes).
const DEVICE_TYPES: { suffix: string; label: string; endpoint: string }[] = [
	{ suffix: 'TOTPDevice', label: 'Application TOTP', endpoint: 'totp' },
	{ suffix: 'WebAuthnDevice', label: 'Clé de sécurité (WebAuthn)', endpoint: 'webauthn' },
	{ suffix: 'StaticDevice', label: 'Codes de secours', endpoint: 'static' },
	{ suffix: 'DuoDevice', label: 'Duo', endpoint: 'duo' },
	{ suffix: 'SMSDevice', label: 'SMS', endpoint: 'sms' },
	{ suffix: 'EmailDevice', label: 'Email', endpoint: 'email' }
];

function deviceTypeInfo(type: string) {
	return DEVICE_TYPES.find((t) => type.endsWith(t.suffix));
}

export async function listMfaDevices(pk: number): Promise<MfaDevice[]> {
	const res = await authentikApiFetch(`authenticators/admin/all/?user=${pk}`);
	const devices = (await res.json()) as DeviceRecord[];
	return devices.map((d) => ({
		pk: d.pk,
		name: d.name,
		type: deviceTypeInfo(d.type)?.label ?? d.type,
		created: d.created
	}));
}

export interface UserApplication {
	name: string;
	slug: string;
	launchUrl: string;
	iconUrl: string | null;
	description: string;
	group: string | null;
	openInNewTab: boolean;
}

interface ApplicationRecord {
	name: string;
	slug: string;
	// `launch_url` is the serializer's computed field — falls back to the provider's own launch
	// URL when the application has no explicit override (`meta_launch_url`, which is commonly
	// blank). Use this one, not meta_launch_url, or apps without an override go missing.
	launch_url: string | null;
	meta_icon_url: string | null;
	meta_description: string;
	group: string;
	open_in_new_tab: boolean;
}

// `for_user` makes Authentik run its own policy engine as that user rather than as our (fully
// privileged) service account — so this only ever returns what they'd actually see in Authentik's
// own application library, not every app that exists. That same endpoint already excludes
// meta_hide apps server-side, so there's no need to filter those out again here.
//
// Passport itself is excluded by name below rather than marked "hide" in Authentik, per the
// member's choice — fragile if that application gets renamed there, but a one-line fix if so.
const SELF_APPLICATION_NAME = 'Passport (Members)';

export async function listUserApplications(pk: number): Promise<UserApplication[]> {
	const res = await authentikApiFetch(`core/applications/?for_user=${pk}&page_size=200`);
	const data = (await res.json()) as { results: ApplicationRecord[] };
	return data.results
		// No launch_url means there's nothing for a link to point to. Also drop Passport's own
		// entry — a member looking at this list is, by definition, already on Passport.
		.filter((a) => a.launch_url && a.name !== SELF_APPLICATION_NAME)
		.map((a) => ({
			name: a.name,
			slug: a.slug,
			launchUrl: a.launch_url as string,
			// Authentik returns icon paths relative to its own origin, not ours.
			iconUrl: a.meta_icon_url ? new URL(a.meta_icon_url, authentikOrigin()).toString() : null,
			description: a.meta_description,
			group: a.group || null,
			openInNewTab: a.open_in_new_tab
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteMfaDevice(userPk: number, devicePk: string): Promise<void> {
	// Re-fetch the raw (untranslated) records ourselves rather than trusting a client-supplied
	// type — this also doubles as the ownership check (device must belong to userPk).
	const res = await authentikApiFetch(`authenticators/admin/all/?user=${userPk}`);
	const devices = (await res.json()) as DeviceRecord[];
	const device = devices.find((d) => d.pk === devicePk);
	if (!device) {
		throw new Error('Appareil MFA introuvable pour cet utilisateur.');
	}

	const info = deviceTypeInfo(device.type);
	if (!info) {
		throw new Error(`Type d'appareil MFA non reconnu : ${device.type}`);
	}

	await authentikApiFetch(`authenticators/admin/${info.endpoint}/${devicePk}/`, { method: 'DELETE' });
}
