import { requireEnv } from '$lib/server/env';

function apiBase(): string {
	return `${requireEnv('MATTERMOST_URL').replace(/\/+$/, '')}/api/v4/`;
}

// Distinct from mattermost.ts's read-only mattermostApiFetch (different token, different job):
// this one posts, using the bot account's own credential rather than the read-only lookup token.
async function mattermostBotFetch(path: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(new URL(path, apiBase()), {
		...init,
		headers: {
			Authorization: `Bearer ${requireEnv('MATTERMOST_BOT_TOKEN')}`,
			'Content-Type': 'application/json',
			...init?.headers
		}
	});

	if (!res.ok) {
		throw new Error(`Mattermost bot request to ${path} failed (${res.status}): ${await res.text()}`);
	}

	return res;
}

// Posts as the bot into an already-known channel (e.g. the admin channel) — no lookup needed,
// just the channel's id.
export async function postToChannel(channelId: string, message: string): Promise<void> {
	await mattermostBotFetch('posts', {
		method: 'POST',
		body: JSON.stringify({ channel_id: channelId, message })
	});
}

async function getUserIdByUsername(username: string): Promise<string> {
	const res = await mattermostBotFetch(`users/username/${encodeURIComponent(username)}`);
	const user = (await res.json()) as { id: string };
	return user.id;
}

// Creating a direct channel is idempotent — Mattermost returns the existing one if the bot and
// this member already have one, so no need to check first.
async function getOrCreateDirectChannelId(userId: string): Promise<string> {
	const res = await mattermostBotFetch('channels/direct', {
		method: 'POST',
		body: JSON.stringify([requireEnv('MATTERMOST_BOT_ID'), userId])
	});
	const channel = (await res.json()) as { id: string };
	return channel.id;
}

// Takes a Mattermost username rather than an email — resolving a member's email to their
// Mattermost username is mattermost.ts's job (a different branch's module as of this writing);
// this one only knows how to talk to Mattermost once it already has a username.
export async function postDirectMessage(username: string, message: string): Promise<void> {
	const userId = await getUserIdByUsername(username);
	const channelId = await getOrCreateDirectChannelId(userId);
	await postToChannel(channelId, message);
}
