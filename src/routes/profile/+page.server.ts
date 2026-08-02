import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	updateUserProfile,
	getAuthentikAccountUrl,
	PROFILE_ATTRIBUTE_FIELDS
} from '$lib/server/authentikAdmin';
import { authentikPk } from '$lib/types';

const REQUIRED_MESSAGES: Record<string, string> = {
	firstName: 'Le prénom ne peut pas être vide.',
	lastName: 'Le nom ne peut pas être vide.',
	phoneNumber: 'Le téléphone ne peut pas être vide.',
	street: 'La rue ne peut pas être vide.',
	postal_code: 'Le code postal ne peut pas être vide.',
	locality: 'La localité ne peut pas être vide.',
	country: 'Le pays ne peut pas être vide.'
};

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

export const load: PageServerLoad = async ({ locals, parent }) => {
	resolvePk(locals);

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
		const pk = resolvePk(locals);
		const formData = await request.formData();

		const firstName = String(formData.get('firstName') ?? '').trim();
		const lastName = String(formData.get('lastName') ?? '').trim();
		const attributes: Record<string, string> = {};
		for (const { key } of PROFILE_ATTRIBUTE_FIELDS) {
			attributes[key] = String(formData.get(key) ?? '').trim();
		}
		// Normalize away spaces/dashes/parens users naturally type ("32 470 00 00 00") so the
		// stored value matches the plain-digits format the field asks for.
		attributes.phoneNumber = attributes.phoneNumber.replace(/[\s().-]/g, '');

		if (!firstName) {
			return fail(400, { error: REQUIRED_MESSAGES.firstName, firstName, lastName, attributes });
		}
		if (!lastName) {
			return fail(400, { error: REQUIRED_MESSAGES.lastName, firstName, lastName, attributes });
		}
		for (const { key } of PROFILE_ATTRIBUTE_FIELDS) {
			if (!attributes[key]) {
				return fail(400, { error: REQUIRED_MESSAGES[key], firstName, lastName, attributes });
			}
		}
		// Country code + local number, digits only, no leading '+' or '0' (e.g. 32470000000).
		if (!/^[1-9]\d{7,14}$/.test(attributes.phoneNumber)) {
			return fail(400, {
				error: 'Numéro de téléphone invalide (format attendu: 32470000000, sans "+" ni "0" initial).',
				firstName,
				lastName,
				attributes
			});
		}

		// Authentik only has a single `name` field — merge on write, split back on display.
		const name = `${firstName} ${lastName}`.trim();
		const changed = await updateUserProfile(pk, { name, attributes });

		return { success: true, changed, firstName, lastName, attributes };
	}
};
