import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getGithubUsername, setGithubUsername } from '$lib/server/authentikAdmin';
import { getGithubOrgMembershipStatus, inviteToGithubOrg } from '$lib/server/githubApp';
import { authentikPk } from '$lib/types';

// Same auth guard shape as the rest of the app.
function resolvePk(locals: App.Locals): number {
	if (!locals.user) {
		redirect(302, '/login');
	}
	const pk = authentikPk(locals.user);
	if (!pk) {
		error(500, 'Impossible de résoudre votre identifiant Authentik (sub).');
	}
	return pk;
}

export const load: PageServerLoad = async ({ locals }) => {
	const pk = resolvePk(locals);
	const githubUsername = await getGithubUsername(pk);
	const membershipStatus = githubUsername
		? await getGithubOrgMembershipStatus(githubUsername)
		: null;
	return { githubUsername, membershipStatus };
};

export const actions: Actions = {
	invite: async ({ locals }) => {
		const pk = resolvePk(locals);

		// Re-read from Authentik rather than trust anything the client could submit — the verified
		// username is only ever set by the OAuth callback, never hand-typed into this form.
		const githubUsername = await getGithubUsername(pk);
		if (!githubUsername) {
			return fail(400, { error: "Connectez d'abord votre compte GitHub." });
		}

		const result = await inviteToGithubOrg(githubUsername);
		if (!result.ok) {
			return fail(400, { error: result.error });
		}

		return { success: true };
	},

	// Clears the Passport-side link only — doesn't touch anything on GitHub (no effect on an
	// already-sent invitation or existing org membership). Lets a member fix a mistaken link by
	// deliberately resetting first, rather than /github/connect allowing a silent account swap.
	disconnect: async ({ locals }) => {
		const pk = resolvePk(locals);
		await setGithubUsername(pk, '');
		return { success: true, disconnected: true };
	}
};
