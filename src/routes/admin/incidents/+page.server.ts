import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { listIncidents } from '$lib/server/incidents';
import { listIncidentPhotos } from '$lib/server/incidentPhotos';

// Declarations filed on /incidents, admin-only (also enforced by admin/+layout.server.ts).
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const incidents = await listIncidents();
	return { incidents: incidents.map((incident) => ({ ...incident, photos: listIncidentPhotos(incident.id) })) };
};
