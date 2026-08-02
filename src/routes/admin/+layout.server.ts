import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isAdmin } from '$lib/types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}
	if (!isAdmin(locals.user)) {
		error(403, 'Accès réservé aux administrateurs.');
	}
};
