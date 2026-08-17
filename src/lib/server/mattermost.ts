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
// Metadata about the last successful fetch, kept separate from `cached` so the footer can report
// it (see getMattermostCacheStatus()) without ever triggering a fetch itself — unlike Authentik/
// Dolibarr's footer indicators, this one only reflects whatever the trombinoscope/admin already
// caused to happen, it never adds its own per-page-load cost.
let lastFetch: { latencyMs: number; cachedAt: number } | null = null;
// The trombinoscope resolves every visible member's Mattermost username concurrently
// (Promise.all in listDirectoryMembers) — without this, a cold cache means N members with
// "Pseudo Chat" on all see `cached` as empty at the same instant and each kick off their own full
// fetch. Memoizing the in-flight promise itself (not just the resolved value) means they all await
// the same request instead.
let inFlight: Promise<Map<string, string>> | null = null;

async function getEmailToUsernameMap(): Promise<Map<string, string>> {
	if (cached && cached.expiresAt > Date.now()) {
		return cached.emailToUsername;
	}
	if (inFlight) {
		return inFlight;
	}

	inFlight = (async () => {
		const start = Date.now();
		const users = await fetchAllMattermostUsers();
		const latencyMs = Date.now() - start;

		const emailToUsername = new Map<string, string>();
		for (const u of users) {
			if (u.delete_at === 0 && u.email) {
				emailToUsername.set(u.email.toLowerCase().trim(), u.username);
			}
		}

		const now = Date.now();
		cached = { emailToUsername, expiresAt: now + CACHE_TTL_MS };
		lastFetch = { latencyMs, cachedAt: now };
		return emailToUsername;
	})();

	try {
		return await inFlight;
	} finally {
		inFlight = null;
	}
}

// Matches by email against the member's own Authentik email — same identity key already used to
// link other services (see the "non éditable" note on /profile). Returns null if the member has
// no active Mattermost account under that email, or uses a different email on each service.
export async function getMattermostUsername(email: string): Promise<string | null> {
	const map = await getEmailToUsernameMap();
	return map.get(email.toLowerCase().trim()) ?? null;
}

// Lets an admin force a refresh (new Mattermost signup, account renamed, etc.) rather than wait
// out the hour-long TTL. Rebuilds immediately rather than just dropping the cache — an admin
// clicking "Régénérer" expects the footer to show a fresh cache right after, not "jamais rempli"
// until the next unrelated trombinoscope visit happens to trigger one.
export async function refreshMattermostCache(): Promise<void> {
	cached = null;
	lastFetch = null;
	await getEmailToUsernameMap();
}

// Read-only, never triggers a fetch — `null` means no successful fetch has happened yet (fresh
// deploy, or right after an admin's manual invalidation) rather than an error.
export function getMattermostCacheStatus(): { latencyMs: number; cachedAt: number } | null {
	return lastFetch;
}

// Opens Mattermost directly on a DM composer with this member — standard Mattermost URL scheme,
// no API call needed to build it.
export function buildMattermostDmUrl(username: string): string {
	return `${requireEnv('MATTERMOST_URL').replace(/\/+$/, '')}/${requireEnv('MATTERMOST_TEAM_SLUG')}/messages/@${username}`;
}
