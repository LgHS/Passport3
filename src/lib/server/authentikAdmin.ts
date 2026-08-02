import { requireEnv } from '$lib/server/env';

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

export async function findUserPkByUsername(username: string): Promise<number> {
	const res = await authentikApiFetch(`core/users/?username=${encodeURIComponent(username)}`);
	const data = (await res.json()) as { results: AuthentikUserRecord[] };
	const user = data.results[0];
	if (!user) {
		throw new Error(`No Authentik user found with username "${username}"`);
	}
	return user.pk;
}

export async function getUserProfile(pk: number): Promise<UserProfile> {
	const res = await authentikApiFetch(`core/users/${pk}/`);
	const user = (await res.json()) as AuthentikUserRecord;
	return {
		name: user.name,
		email: user.email,
		avatar: user.avatar || null,
		attributes: pickAttributes(user.attributes)
	};
}

export async function updateUserProfile(
	pk: number,
	update: { name: string; attributes: Record<string, string> }
): Promise<void> {
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

	await authentikApiFetch(`core/users/${pk}/`, {
		method: 'PATCH',
		body: JSON.stringify({ name: update.name, attributes: mergedAttributes })
	});
}
