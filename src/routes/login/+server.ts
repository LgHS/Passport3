import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAuthorizationUrl, OidcUnavailableError } from '$lib/server/authentik';
import { deriveCodeChallenge, generateCodeVerifier, generateState } from '$lib/server/pkce';
import { setOAuthCookies } from '$lib/server/session';

export const GET: RequestHandler = async ({ cookies }) => {
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await deriveCodeChallenge(codeVerifier);

	setOAuthCookies(cookies, state, codeVerifier);

	let authorizationUrl: string;
	try {
		authorizationUrl = await createAuthorizationUrl(state, codeChallenge);
	} catch (err) {
		if (err instanceof OidcUnavailableError) {
			error(503, 'La connexion est temporairement indisponible. Réessayez dans quelques instants.');
		}
		throw err;
	}
	redirect(302, authorizationUrl);
};
