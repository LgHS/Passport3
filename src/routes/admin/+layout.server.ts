import type { LayoutServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';

export const load: LayoutServerLoad = ({ locals }) => {
	requireAdmin(locals);
};
