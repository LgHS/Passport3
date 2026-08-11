import { createSign } from 'node:crypto';
import { requireEnv } from '$lib/server/env';

function base64url(input: string): string {
	return Buffer.from(input).toString('base64url');
}

// Stored as base64 of the .pem contents directly in the env var (not a file path): simpler and
// safer to deploy — one secret to inject, no volume/file to mount, and no risk of the key ending
// up inside the repo working tree where a stale .gitignore on some other branch might not exclude
// it (a plain file under the repo did exactly that once).
let cachedPrivateKey: string | null = null;
function loadPrivateKey(): string {
	if (!cachedPrivateKey) {
		cachedPrivateKey = Buffer.from(requireEnv('GITHUB_APP_PRIVATE_KEY_BASE64'), 'base64').toString(
			'utf-8'
		);
	}
	return cachedPrivateKey;
}

// GitHub Apps authenticate as themselves via a short-lived JWT (max 10 min per GitHub's rules),
// signed with the App's own private key — this proves "I am this App" and is exchanged below for
// an installation access token, the credential actually used to call the org invitations API.
// GitHub now recommends client_id over the numeric app_id as the `iss` claim.
function createAppJwt(): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'RS256', typ: 'JWT' };
	const payload = {
		iat: now - 60, // backdated a bit to tolerate clock drift between this server and GitHub's
		exp: now + 9 * 60,
		iss: requireEnv('GITHUB_APP_CLIENT_ID')
	};

	const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

	const signer = createSign('RSA-SHA256');
	signer.update(signingInput);
	signer.end();
	const signature = signer.sign(loadPrivateKey()).toString('base64url');

	return `${signingInput}.${signature}`;
}

interface InstallationTokenResponse {
	token: string;
	expires_at: string;
}

let cachedInstallationToken: { token: string; expiresAt: number } | null = null;

// Installation tokens last 1h — cached in-memory (with a safety margin) so a burst of invitations
// doesn't mint a fresh App JWT + token on every single request.
async function getInstallationAccessToken(): Promise<string> {
	if (cachedInstallationToken && cachedInstallationToken.expiresAt > Date.now() + 60_000) {
		return cachedInstallationToken.token;
	}

	const installationId = requireEnv('GITHUB_APP_INSTALLATION_ID');
	const res = await fetch(
		`https://api.github.com/app/installations/${installationId}/access_tokens`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${createAppJwt()}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28'
			}
		}
	);

	if (!res.ok) {
		throw new Error(`GitHub installation token request failed (${res.status}): ${await res.text()}`);
	}

	const data = (await res.json()) as InstallationTokenResponse;
	cachedInstallationToken = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
	return data.token;
}

function githubApiHeaders(token: string): HeadersInit {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};
}

export type GithubOrgMembershipStatus = 'member' | 'pending' | 'none';

// Whether `username` is already a confirmed member of GITHUB_ORG, has a pending invitation, or
// neither — a single call covers both, since GitHub creates a "pending" membership record the
// moment an invitation is sent, which flips to "active" once accepted.
export async function getGithubOrgMembershipStatus(
	username: string
): Promise<GithubOrgMembershipStatus> {
	const token = await getInstallationAccessToken();
	const org = requireEnv('GITHUB_ORG');

	const res = await fetch(
		`https://api.github.com/orgs/${org}/memberships/${encodeURIComponent(username)}`,
		{ headers: githubApiHeaders(token) }
	);

	if (res.status === 404) return 'none';
	if (!res.ok) {
		throw new Error(`GitHub membership lookup failed (${res.status}): ${await res.text()}`);
	}

	const data = (await res.json()) as { state?: string };
	return data.state === 'active' ? 'member' : 'pending';
}

export type GithubInviteResult = { ok: true } | { ok: false; error: string };

interface GithubErrorBody {
	message?: string;
	errors?: { message?: string }[];
}

// Resolves the username to an account id, then invites it to GITHUB_ORG. The App's installation
// token (Members: Read and write, nothing else) is the only credential used here — never the
// member's own OAuth token from the identity-verification step, which only ever had read:user.
export async function inviteToGithubOrg(username: string): Promise<GithubInviteResult> {
	const token = await getInstallationAccessToken();
	const org = requireEnv('GITHUB_ORG');

	const userRes = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
		headers: githubApiHeaders(token)
	});

	if (userRes.status === 404) {
		return { ok: false, error: `Le compte GitHub @${username} est introuvable.` };
	}
	if (!userRes.ok) {
		throw new Error(`GitHub user lookup failed (${userRes.status}): ${await userRes.text()}`);
	}
	const user = (await userRes.json()) as { id: number };

	const inviteRes = await fetch(`https://api.github.com/orgs/${org}/invitations`, {
		method: 'POST',
		headers: { ...githubApiHeaders(token), 'Content-Type': 'application/json' },
		body: JSON.stringify({ invitee_id: user.id })
	});

	if (inviteRes.status === 422) {
		// Already a member, invitation already pending, etc. — GitHub explains which in the body.
		const body = (await inviteRes.json().catch(() => null)) as GithubErrorBody | null;
		const detail = body?.errors?.[0]?.message ?? body?.message;
		return {
			ok: false,
			error:
				detail ??
				`@${username} ne peut pas être invité (déjà membre, ou invitation déjà en attente).`
		};
	}
	if (!inviteRes.ok) {
		throw new Error(`GitHub org invitation failed (${inviteRes.status}): ${await inviteRes.text()}`);
	}

	return { ok: true };
}
