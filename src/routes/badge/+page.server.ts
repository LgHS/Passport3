import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	// TODO: replace with the real UUID (and wire the regen action to the backend that reissues
	// the badge) once that exists — front-end shell only for now, per plan.
	return { uuid: '00000000-0000-4000-8000-000000000000' };
};
