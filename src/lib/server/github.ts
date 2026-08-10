import { requireEnv } from '$lib/server/env';

interface GithubTokenResponse {
	access_token?: string;
	error?: string;
	error_description?: string;
}

export interface GithubUser {
	login: string;
	id: number;
	avatar_url: string;
}

// No PKCE here unlike Authentik's OIDC flow: GitHub OAuth Apps are a confidential client (the
// client_secret is used server-side in exchangeGithubCode below), and GitHub's authorization code
// flow doesn't support PKCE anyway — `state` still guards against CSRF.
export function createGithubAuthorizationUrl(state: string): string {
	const url = new URL('https://github.com/login/oauth/authorize');
	url.searchParams.set('client_id', requireEnv('GITHUB_OAUTH_CLIENT_ID'));
	url.searchParams.set('redirect_uri', requireEnv('GITHUB_OAUTH_REDIRECT_URI'));
	// Just enough to read the authenticated user's identity (GET /user below) — no org/write
	// scopes. Sending the actual invitation is a separate, privileged server-side call, not
	// something this member-facing OAuth token is used for.
	url.searchParams.set('scope', 'read:user');
	url.searchParams.set('state', state);
	return url.toString();
}

export async function exchangeGithubCode(code: string): Promise<string> {
	const res = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			// Without this, GitHub replies with a form-urlencoded body instead of JSON.
			Accept: 'application/json'
		},
		body: new URLSearchParams({
			client_id: requireEnv('GITHUB_OAUTH_CLIENT_ID'),
			client_secret: requireEnv('GITHUB_OAUTH_CLIENT_SECRET'),
			code,
			redirect_uri: requireEnv('GITHUB_OAUTH_REDIRECT_URI')
		})
	});

	if (!res.ok) {
		throw new Error(`GitHub token exchange failed (${res.status}): ${await res.text()}`);
	}

	const data = (await res.json()) as GithubTokenResponse;
	if (!data.access_token) {
		throw new Error(
			`GitHub token exchange returned no access_token: ${data.error_description ?? data.error ?? 'unknown error'}`
		);
	}

	return data.access_token;
}

export async function getGithubUser(accessToken: string): Promise<GithubUser> {
	const res = await fetch('https://api.github.com/user', {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});

	if (!res.ok) {
		throw new Error(`GitHub user fetch failed (${res.status}): ${await res.text()}`);
	}

	return res.json() as Promise<GithubUser>;
}
