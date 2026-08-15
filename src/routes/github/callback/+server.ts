import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeGithubCode, getGithubUser } from '$lib/server/github';
import { setGithubUsername } from '$lib/server/authentikAdmin';
import { GITHUB_OAUTH_STATE_COOKIE, clearGithubOAuthStateCookie } from '$lib/server/session';
import { authentikPk } from '$lib/types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}
	const pk = authentikPk(locals.user);
	if (!pk) {
		error(500, 'Impossible de résoudre votre identifiant Authentik (sub).');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expectedState = cookies.get(GITHUB_OAUTH_STATE_COOKIE);
	clearGithubOAuthStateCookie(cookies);

	if (!code || !state || !expectedState || state !== expectedState) {
		error(400, 'Tentative de connexion GitHub invalide ou expirée, réessayez.');
	}

	const accessToken = await exchangeGithubCode(code);
	// The GitHub identity comes straight from GitHub's own API using a token it just issued after
	// a successful login — trustworthy on its own, no separate signature verification needed
	// (unlike Authentik's id_token, which is a JWT verified against Authentik's JWKS).
	const githubUser = await getGithubUser(accessToken);
	await setGithubUsername(pk, githubUser.login);

	redirect(302, '/github?connected=1');
};
