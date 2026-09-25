import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getGithubUsername, setGithubUsername } from '$lib/server/authentikAdmin';
import { getGithubOrgMembershipStatus, inviteToGithubOrg, GithubUnavailableError } from '$lib/server/githubApp';
import { logAuditEvent } from '$lib/server/auditLog';
import { requireEnv } from '$lib/server/env';
import { authentikPk, displayName } from '$lib/types';

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

	const githubOrgUrl = `https://github.com/${requireEnv('GITHUB_ORG')}`;

	if (!githubUsername) {
		return { githubUsername: null, membershipStatus: null, githubUnavailable: false, githubOrgUrl };
	}

	try {
		const membershipStatus = await getGithubOrgMembershipStatus(githubUsername);
		return { githubUsername, membershipStatus, githubUnavailable: false, githubOrgUrl };
	} catch (err) {
		if (err instanceof GithubUnavailableError) {
			// Distinct from `membershipStatus === null` meaning "no linked account" — this member
			// *is* linked, we just can't tell their status right now. The page must not fall
			// through to the invite button while that's unknown (see feedback_distinguish-fetch-
			// failure-from-empty), it would risk a redundant invite attempt against a status we
			// never actually confirmed.
			return { githubUsername, membershipStatus: null, githubUnavailable: true, githubOrgUrl };
		}
		throw err;
	}
};

export const actions: Actions = {
	invite: async ({ locals }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;

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

		logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'github.invite',
			{ pk },
			{ githubUsername }
		);

		return { success: true };
	},

	// Clears the Passport-side link only — doesn't touch anything on GitHub (no effect on an
	// already-sent invitation or existing org membership). Lets a member fix a mistaken link by
	// deliberately resetting first, rather than /github/connect allowing a silent account swap.
	disconnect: async ({ locals }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;

		const before = await getGithubUsername(pk);
		await setGithubUsername(pk, '');

		logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'github.disconnect',
			{ pk },
			{ before: { githubUsername: before }, after: { githubUsername: null } }
		);

		return { success: true, disconnected: true };
	}
};
