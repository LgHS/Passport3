import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createGithubAuthorizationUrl } from '$lib/server/github';
import { getGithubUsername } from '$lib/server/authentikAdmin';
import { generateState } from '$lib/server/pkce';
import { setGithubOAuthStateCookie } from '$lib/server/session';
import { authentikPk } from '$lib/types';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	// One GitHub account per member, permanently — once linked, self-service reconnection is
	// blocked here (not just hidden in the UI), so a member can't freely swap which account is
	// tied to their Passport identity and accumulate several org invitations over time.
	const pk = authentikPk(locals.user);
	if (pk && (await getGithubUsername(pk))) {
		redirect(302, '/github');
	}

	const state = generateState();
	setGithubOAuthStateCookie(cookies, state);
	redirect(302, createGithubAuthorizationUrl(state));
};
