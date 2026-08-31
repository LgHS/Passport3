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
	getUserGroups,
	HEX_COLOR_RE,
	getEmergencyContacts,
	updateEmergencyContacts,
	MAX_EMERGENCY_CONTACTS
} from '$lib/server/authentikAdmin';
import { validateProfileSubmission, validateEmergencyContactsSubmission } from '$lib/server/profileValidation';
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

	const [profile, optin, tag, groups, emergencyContacts] = await Promise.all([
		getUserProfile(pk).catch(() => null),
		getTrombinoscopeOptin(pk),
		getTrombinoscopeTag(pk),
		// Best-effort, same reasoning as getUserProfile's .catch() above — a transient Authentik
		// hiccup on this specific call shouldn't 500 the whole edit page (profile, visibility, tag
		// all fail together via Promise.all) just because the Permissions section couldn't load.
		// null (not []) on failure — "couldn't check" must stay distinguishable from "genuinely no
		// groups", the two read very differently to an admin looking at someone's access.
		getUserGroups(pk).catch(() => null),
		// Same reasoning — an admin seeing "aucun contact" during an actual emergency must never be
		// a fetch hiccup in disguise, see feedback_distinguish-fetch-failure-from-empty.
		getEmergencyContacts(pk).catch(() => null)
	]);
	if (!profile) {
		error(404, 'Membre introuvable.');
	}

	return {
		pk,
		profile,
		fields: PROFILE_ATTRIBUTE_FIELDS,
		optin,
		tag,
		groups,
		emergencyContacts,
		maxEmergencyContacts: MAX_EMERGENCY_CONTACTS
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
	},

	updateEmergencyContacts: async ({ request, params, locals }) => {
		requireAdmin(locals);

		const pk = resolvePk(params.pk);
		const result = validateEmergencyContactsSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, { emergencyContactsError: result.error, emergencyContacts: result.contacts });
		}

		try {
			await updateEmergencyContacts(pk, result.contacts);
		} catch {
			return fail(500, {
				emergencyContactsError: "La sauvegarde des contacts d'urgence a échoué, réessayez.",
				emergencyContacts: result.contacts
			});
		}

		return { emergencyContactsSuccess: true, emergencyContacts: result.contacts };
	}
};
