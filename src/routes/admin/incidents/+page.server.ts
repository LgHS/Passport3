import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { listIncidents } from '$lib/server/incidents';

// Declarations filed on /incidents, admin-only (also enforced by admin/+layout.server.ts).
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	return { incidents: await listIncidents() };
};
