import { requireEnv } from '$lib/server/env';
import { getCachedProfile, setCachedProfile } from '$lib/server/profileCache';

export interface ProfileAttributeField {
	key: string;
	label: string;
}

// Whitelist that also acts as the merge boundary for updateUserProfile: only these keys are
// ever read from or written into the user's Authentik `attributes` blob.
export const PROFILE_ATTRIBUTE_FIELDS: ProfileAttributeField[] = [
	{ key: 'phoneNumber', label: 'Téléphone (format: 32470000000)' },
	{ key: 'street', label: 'Rue & Numéro' },
	{ key: 'postal_code', label: 'Code postal' },
	{ key: 'locality', label: 'Localité' },
	{ key: 'country', label: 'Pays' }
];

export interface UserProfile {
	name: string;
	email: string;
	avatar: string | null;
	attributes: Record<string, string>;
}

interface AuthentikUserRecord {
	pk: number;
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
		name: update.name,
		email: currentUser.email,
		avatar: currentUser.avatar || null,
		attributes: pickAttributes(mergedAttributes)
	});

	return true;
}
