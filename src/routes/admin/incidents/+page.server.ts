import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin, requireAdminUser } from '$lib/server/auth';
import { deleteIncident, listIncidents } from '$lib/server/incidents';
import { deleteIncidentPhotos, listIncidentPhotos } from '$lib/server/incidentPhotos';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

// Declarations filed on /incidents, admin-only (also enforced by admin/+layout.server.ts).
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const incidents = await listIncidents();
	return { incidents: incidents.map((incident) => ({ ...incident, photos: listIncidentPhotos(incident.id) })) };
};

export const actions: Actions = {
	// Removes a declaration and its photos for good — a mistaken or duplicate one. Declarations are
	// otherwise kept with no time limit.
	delete: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);
		const id = Number((await request.formData()).get('incidentId'));
		if (!Number.isInteger(id) || id < 1) return fail(400, { error: 'Requête invalide.' });

		const deleted = await deleteIncident(id);
		if (!deleted) return fail(404, { error: 'Déclaration introuvable.' });
		// The row is gone either way; a photo folder left behind is only logged, not reported as a
		// failed deletion.
		try {
			deleteIncidentPhotos(id);
		} catch (err) {
			console.error(`[incidents] removing the photos of #${id} failed:`, err);
		}

		// Same minimal details as incident.create: never what the declaration said.
		const authorPk = Number(deleted.authorSub);
		await logAuditEvent(
			{ sub: admin.sub, label: displayName(admin) },
			'admin',
			'incident.delete',
			Number.isInteger(authorPk) && authorPk > 0 ? { pk: authorPk } : {},
			{ incidentId: id, kind: deleted.kind }
		);
		return { deleted: true };
	}
};
