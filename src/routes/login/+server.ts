import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAuthorizationUrl } from '$lib/server/authentik';
import { deriveCodeChallenge, generateCodeVerifier, generateState } from '$lib/server/pkce';
import { setOAuthCookies } from '$lib/server/session';

export const GET: RequestHandler = async ({ cookies }) => {
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await deriveCodeChallenge(codeVerifier);

	setOAuthCookies(cookies, state, codeVerifier);

	const authorizationUrl = await createAuthorizationUrl(state, codeChallenge);
	redirect(302, authorizationUrl);
};
