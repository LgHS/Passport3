import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getUserProfile,
	updateUserProfile,
	PROFILE_ATTRIBUTE_FIELDS,
	getTrombinoscopeOptin,
	updateTrombinoscopeOptin,
	optinFromFormData,
	getTrombinoscopeTag,
	updateTrombinoscopeTag,
	HEX_COLOR_RE
} from '$lib/server/authentikAdmin';
import { lookupMattermostUsername, buildMattermostDmUrl } from '$lib/server/mattermost';
import { validateProfileSubmission } from '$lib/server/profileValidation';
import { requireAdmin } from '$lib/server/auth';

function resolvePk(paramPk: string): number {
	const pk = Number(paramPk);
	if (!Number.isInteger(pk) || pk <= 0) {
		error(404, 'Membre introuvable.');
	}
	return pk;
}

export const load: PageServerLoad = async ({ params }) => {
	const pk = resolvePk(params.pk);

	const profile = await getUserProfile(pk).catch(() => null);
	if (!profile) {
		error(404, 'Membre introuvable.');
	}

	const [optin, tag, mattermost] = await Promise.all([
		getTrombinoscopeOptin(pk),
		getTrombinoscopeTag(pk),
		// Admin-only: shown regardless of the member's own "Pseudo Chat" opt-in on the
		// trombinoscope — this is an internal tool to reach a member for oral/email requests, not
		// the public directory, so it isn't gated by the same consent. `unavailable` stays
		// distinguishable from "no linked account" — see feedback_distinguish-fetch-failure-from-empty.
		lookupMattermostUsername(profile.email)
	]);
	const mattermostDmUrl = mattermost.username ? buildMattermostDmUrl(mattermost.username) : null;

	return {
		pk,
		profile,
		fields: PROFILE_ATTRIBUTE_FIELDS,
		optin,
		tag,
		mattermostUsername: mattermost.username,
		mattermostUnavailable: mattermost.unavailable,
		mattermostDmUrl
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, params, locals }) => {
		requireAdmin(locals);

		const pk = resolvePk(params.pk);
		const result = validateProfileSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, {
				error: result.error,
				firstName: result.firstName,
				lastName: result.lastName,
				attributes: result.attributes
			});
		}

		const changed = await updateUserProfile(pk, { name: result.name, attributes: result.attributes });

		return {
			success: true,
			changed,
			firstName: result.firstName,
			lastName: result.lastName,
			attributes: result.attributes
		};
	},

	// Lets an admin set another member's trombinoscope visibility on their behalf (oral/email
	// requests) — same read-merge-write helper as the member-facing form, but the target pk comes
	// from the trusted route param, never from form data.
	updateOptin: async ({ request, params, locals }) => {
		requireAdmin(locals);

		const pk = resolvePk(params.pk);
		const formData = await request.formData();
		const optin = optinFromFormData(formData);

		try {
			await updateTrombinoscopeOptin(pk, optin);
		} catch {
			return fail(500, { optinError: "La sauvegarde de la visibilité a échoué, réessayez." });
		}

		return { optinSuccess: true, optin };
	},

	// Admin-only role label (e.g. "Prés. CA") + badge color shown on the trombinoscope —
	// never edited by the member themselves, see TrombinoscopeTag.
	updateTag: async ({ request, params, locals }) => {
		requireAdmin(locals);

		const pk = resolvePk(params.pk);
		const formData = await request.formData();
		const tag = String(formData.get('tag') ?? '').trim();
		const tagColor = String(formData.get('tagColor') ?? '')
			.trim()
			.replace(/^#/, '')
			.toLowerCase();

		if (tagColor && !HEX_COLOR_RE.test(tagColor)) {
			return fail(400, {
				tagError: 'Couleur invalide (format attendu : 6 caractères hexadécimaux, ex. ffd800).',
				tag,
				tagColor
			});
		}

		try {
			await updateTrombinoscopeTag(pk, { tag: tag || null, tagColor: tagColor || null });
		} catch {
			return fail(500, { tagError: 'La sauvegarde du rôle a échoué, réessayez.', tag, tagColor });
		}

		return { tagSuccess: true, tag, tagColor };
	}
};
