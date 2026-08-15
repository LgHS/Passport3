import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppUser } from '$lib/types';
import { requireEnv } from '$lib/server/env';

interface OidcConfig {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	jwks_uri: string;
	end_session_endpoint?: string;
}

interface TokenResponse {
	access_token: string;
	id_token: string;
	refresh_token?: string;
	expires_in: number;
	token_type: string;
}

let configPromise: Promise<OidcConfig> | null = null;
let configFailedAt: number | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

// If Authentik is actually down, don't let every single /login attempt during the outage fire its
// own discovery fetch — fail fast for a short cooldown instead, then let the next request retry.
const RETRY_COOLDOWN_MS = 10_000;

// Authentik's provider-scoped endpoints (jwks, end-session) can't be reliably guessed from the
// issuer URL alone, so we fetch the standard OIDC discovery document instead of hardcoding paths.
async function getOidcConfig(): Promise<OidcConfig> {
	if (!configPromise) {
		if (configFailedAt && Date.now() - configFailedAt < RETRY_COOLDOWN_MS) {
			throw new Error('Authentik OIDC discovery is temporarily unavailable, try again shortly.');
		}

		const issuer = requireEnv('AUTHENTIK_ISSUER');
		const base = issuer.endsWith('/') ? issuer : `${issuer}/`;
		configPromise = fetch(new URL('.well-known/openid-configuration', base))
			.then(async (res) => {
				if (!res.ok) {
					throw new Error(`Failed to fetch Authentik OIDC discovery document (${res.status})`);
				}
				configFailedAt = null;
				return res.json() as Promise<OidcConfig>;
			})
			.catch((err) => {
				// Also reset on a network-level failure (DNS, connection refused, etc.), not just a
				// non-ok HTTP response — otherwise a single transient blip caches a rejected promise
				// for the lifetime of the process, wedging /login until the server is restarted.
				configPromise = null;
				configFailedAt = Date.now();
				throw err;
			});
	}
	return configPromise;
}

function getJwks(jwksUri: string) {
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(jwksUri));
	}
	return jwks;
}

export async function createAuthorizationUrl(state: string, codeChallenge: string): Promise<string> {
	const config = await getOidcConfig();
	const url = new URL(config.authorization_endpoint);
	url.searchParams.set('client_id', requireEnv('AUTHENTIK_CLIENT_ID'));
	url.searchParams.set('redirect_uri', requireEnv('AUTHENTIK_REDIRECT_URI'));
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', 'openid profile email');
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	return url.toString();
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
	const config = await getOidcConfig();
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: requireEnv('AUTHENTIK_REDIRECT_URI'),
		client_id: requireEnv('AUTHENTIK_CLIENT_ID'),
		client_secret: requireEnv('AUTHENTIK_CLIENT_SECRET'),
		code_verifier: codeVerifier
	});

	const res = await fetch(config.token_endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});

	if (!res.ok) {
		throw new Error(`Authentik token exchange failed (${res.status}): ${await res.text()}`);
	}

	return res.json() as Promise<TokenResponse>;
}

export async function verifyIdToken(idToken: string): Promise<AppUser> {
	const config = await getOidcConfig();
	const { payload } = await jwtVerify(idToken, getJwks(config.jwks_uri), {
		issuer: config.issuer,
		audience: requireEnv('AUTHENTIK_CLIENT_ID')
	});

	return {
		sub: payload.sub as string,
		email: payload.email as string | undefined,
		name:
			(payload.name as string | undefined) ?? (payload.preferred_username as string | undefined),
		preferred_username: payload.preferred_username as string | undefined,
		groups: payload.groups as string[] | undefined
	};
}

export async function getEndSessionUrl(
	idToken: string,
	postLogoutRedirectUri: string
): Promise<string | null> {
	const config = await getOidcConfig();
	if (!config.end_session_endpoint) return null;
	const url = new URL(config.end_session_endpoint);
	url.searchParams.set('id_token_hint', idToken);
	url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
	return url.toString();
}
