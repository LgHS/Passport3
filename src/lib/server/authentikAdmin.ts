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
	await authentikApiFetch(`stages/invitation/invitations/${invitation.pk}/send_email/`, {
		method: 'POST',
		body: JSON.stringify({ email_addresses: [opts.email] })
	});

	return {
		inviteUrl: `${authentikOrigin()}/if/flow/${slug}/?itoken=${invitation.pk}`
	};
}
