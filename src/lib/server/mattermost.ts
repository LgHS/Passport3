import { requireEnv } from '$lib/server/env';

function apiBase(): string {
	return `${requireEnv('MATTERMOST_URL').replace(/\/+$/, '')}/api/v4/`;
}

async function mattermostApiFetch(path: string): Promise<Response> {
	const res = await fetch(new URL(path, apiBase()), {
		headers: { Authorization: `Bearer ${requireEnv('MATTERMOST_TOKEN')}` }
	});

	if (!res.ok) {
		throw new Error(`Mattermost API request to ${path} failed (${res.status}): ${await res.text()}`);
	}

	return res;
}

interface MattermostUserRecord {
	username: string;
	email: string;
	// Non-zero (a Unix ms timestamp) means the account is deactivated/deleted — see
	// https://api.mattermost.com/#tag/users/operation/GetUsers.
	delete_at: number;
}

// Mattermost has no "give me everyone" endpoint — /users is paginated, 200 per page max.
async function fetchAllMattermostUsers(): Promise<MattermostUserRecord[]> {
	const users: MattermostUserRecord[] = [];
	for (let page = 0; ; page++) {
		const res = await mattermostApiFetch(`users?per_page=200&page=${page}`);
		const batch = (await res.json()) as MattermostUserRecord[];
		users.push(...batch);
		if (batch.length < 200) break;
	}
	return users;
}

// email -> Mattermost username, active accounts only. Rebuilt from scratch on every cache miss
// (Mattermost has no "changed since" filter to fetch just a delta) — cheap enough for a
// hackerspace-sized team, and directory data like this doesn't need to be anywhere near as fresh
// as the footer's live up/down health check: a new Mattermost account linking up an hour late is
// a non-issue.
const CACHE_TTL_MS = 60 * 60_000;

let cached: { emailToUsername: Map<string, string>; expiresAt: number } | null = null;

async function getEmailToUsernameMap(): Promise<Map<string, string>> {
	if (cached && cached.expiresAt > Date.now()) {
		return cached.emailToUsername;
	}

	const users = await fetchAllMattermostUsers();
	const emailToUsername = new Map<string, string>();
	for (const u of users) {
		if (u.delete_at === 0 && u.email) {
			emailToUsername.set(u.email.toLowerCase().trim(), u.username);
		}
	}

	cached = { emailToUsername, expiresAt: Date.now() + CACHE_TTL_MS };
	return emailToUsername;
}

// Matches by email against the member's own Authentik email — same identity key already used to
// link other services (see the "non éditable" note on /profile). Returns null if the member has
// no active Mattermost account under that email, or uses a different email on each service.
export async function getMattermostUsername(email: string): Promise<string | null> {
	const map = await getEmailToUsernameMap();
	return map.get(email.toLowerCase().trim()) ?? null;
}
