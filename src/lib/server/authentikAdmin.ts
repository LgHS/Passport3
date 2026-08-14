import { requireEnv } from '$lib/server/env';
import { getCachedProfile, setCachedProfile } from '$lib/server/profileCache';
import type { ProfileAttributeField, UserProfile } from '$lib/types';

export type { ProfileAttributeField, UserProfile };

// Whitelist that also acts as the merge boundary for updateUserProfile: only these keys are
// ever read from or written into the user's Authentik `attributes` blob.
export const PROFILE_ATTRIBUTE_FIELDS: ProfileAttributeField[] = [
	{ key: 'phoneNumber', label: 'Téléphone (format: 32470000000)' },
	{ key: 'street', label: 'Rue & Numéro' },
	{ key: 'postal_code', label: 'Code postal' },
	{ key: 'locality', label: 'Localité' },
	{ key: 'country', label: 'Pays' }
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
	const res = await fetch(new URL(path, apiBase()), {
		...init,
		headers: {
			Authorization: `Bearer ${requireEnv('AUTHENTIK_API_TOKEN')}`,
			'Content-Type': 'application/json',
			...init?.headers
		}
	});

	if (!res.ok) {
		throw new Error(`Authentik API request to ${path} failed (${res.status}): ${await res.text()}`);
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

// Returns whether anything actually changed (and was written), so callers can skip telling the
// user "saved" when they just re-submitted the same values.
export async function updateUserProfile(
	pk: number,
	update: { name: string; attributes: Record<string, string> }
): Promise<boolean> {
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

	const nameChanged = update.name !== currentUser.name;
	const attributesChanged = PROFILE_ATTRIBUTE_FIELDS.some(
		({ key }) => (currentUser.attributes[key] ?? '') !== (mergedAttributes[key] ?? '')
	);

	if (!nameChanged && !attributesChanged) {
		return false;
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

	return true;
}

// Not part of PROFILE_ATTRIBUTE_FIELDS: that whitelist is specifically the merge boundary for
// the member-editable profile form, whereas rfid_uid is provisioned by us and never user-entered.
const RFID_UID_ATTRIBUTE = 'rfid_uid';

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
export async function listUserApplications(pk: number): Promise<UserApplication[]> {
	const res = await authentikApiFetch(`core/applications/?for_user=${pk}&page_size=200`);
	const data = (await res.json()) as { results: ApplicationRecord[] };
	return data.results
		// No launch_url means there's nothing for a link to point to.
		.filter((a) => a.launch_url)
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
