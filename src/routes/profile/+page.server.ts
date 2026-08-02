import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { updateUserProfile, getAuthentikAccountUrl, PROFILE_ATTRIBUTE_FIELDS } from '$lib/server/authentikAdmin';
import { validateProfileSubmission } from '$lib/server/profileValidation';
import { authentikPk } from '$lib/types';

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
	}
};
