import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	findUserPkByUsername,
	updateUserProfile,
	getAuthentikAccountUrl,
	PROFILE_ATTRIBUTE_FIELDS
} from '$lib/server/authentikAdmin';

function resolveUsername(locals: App.Locals): string {
	if (!locals.user) {
		redirect(302, '/login');
	}
	if (!locals.user.preferred_username) {
		error(500, 'Missing preferred_username claim on session — cannot resolve Authentik user.');
	}
	return locals.user.preferred_username;
}

export const load: PageServerLoad = async ({ locals, parent }) => {
	resolveUsername(locals);

	// Reuse the profile the root layout already fetched (for the header avatar) instead of
	// hitting the Authentik API again for the same user.
	const { profile } = await parent();
	if (!profile) {
		error(500, 'Impossible de récupérer votre profil Authentik.');
	}

	return {
		profile,
		fields: PROFILE_ATTRIBUTE_FIELDS,
		authentikAccountUrl: getAuthentikAccountUrl()
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const username = resolveUsername(locals);
		const formData = await request.formData();

		const name = String(formData.get('name') ?? '').trim();
		const attributes: Record<string, string> = {};
		for (const { key } of PROFILE_ATTRIBUTE_FIELDS) {
			attributes[key] = String(formData.get(key) ?? '').trim();
		}
		// Normalize away spaces/dashes/parens users naturally type ("32 470 00 00 00") so the
		// stored value matches the plain-digits format the field asks for.
		attributes.phoneNumber = attributes.phoneNumber.replace(/[\s().-]/g, '');

		if (!name) {
			return fail(400, { error: 'Le nom ne peut pas être vide.', name, attributes });
		}
		// Country code + local number, digits only, no leading '+' or '0' (e.g. 32470000000).
		if (attributes.phoneNumber && !/^[1-9]\d{7,14}$/.test(attributes.phoneNumber)) {
			return fail(400, {
				error: 'Numéro de téléphone invalide (format attendu: 32470000000, sans "+" ni "0" initial).',
				name,
				attributes
			});
		}

		const pk = await findUserPkByUsername(username);
		await updateUserProfile(pk, { name, attributes });

		return { success: true, name, attributes };
	}
};
