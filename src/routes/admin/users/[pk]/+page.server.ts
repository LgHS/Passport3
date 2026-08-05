import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getUserProfile, updateUserProfile, PROFILE_ATTRIBUTE_FIELDS } from '$lib/server/authentikAdmin';
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

	return { pk, profile, fields: PROFILE_ATTRIBUTE_FIELDS };
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
	}
};
