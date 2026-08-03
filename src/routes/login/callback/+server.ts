import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCode, verifyIdToken } from '$lib/server/authentik';
import {
	clearOAuthCookies,
	OAUTH_STATE_COOKIE,
	OAUTH_VERIFIER_COOKIE,
	setSessionCookie
} from '$lib/server/session';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expectedState = cookies.get(OAUTH_STATE_COOKIE);
	const codeVerifier = cookies.get(OAUTH_VERIFIER_COOKIE);

	clearOAuthCookies(cookies);

	if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
		error(400, 'Invalid or expired login attempt. Please try logging in again.');
	}

	const tokens = await exchangeCode(code, codeVerifier);

	// Verify before trusting the token as a session — also confirms it's really Authentik's.
	await verifyIdToken(tokens.id_token);

	setSessionCookie(cookies, tokens.id_token, tokens.expires_in);

	redirect(302, '/');
};
