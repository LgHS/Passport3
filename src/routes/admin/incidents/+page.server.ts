import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin, requireAdminUser } from '$lib/server/auth';
import { listIncidents, softDeleteIncident } from '$lib/server/incidents';
import { listIncidentPhotos } from '$lib/server/incidentPhotos';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

// Declarations filed on /incidents, admin-only (also enforced by admin/+layout.server.ts).
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const incidents = await listIncidents();
	return { incidents: incidents.map((incident) => ({ ...incident, photos: listIncidentPhotos(incident.id) })) };
};

export const actions: Actions = {
	// Hides a mistaken or duplicate declaration. Nothing is destroyed: the row and its photos stay,
	// and the list can show removed declarations on demand. These declarations are required for
	// legal and insurance reasons, so an admin must not be able to make one disappear for good.
	delete: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);
		const id = Number((await request.formData()).get('incidentId'));
		if (!Number.isInteger(id) || id < 1) return fail(400, { error: 'Requête invalide.' });

		const deleted = await softDeleteIncident(id, { sub: admin.sub, label: displayName(admin) });
		// Also covers a declaration already removed, so a double submission doesn't rewrite who
		// removed it.
		if (!deleted) return fail(404, { error: 'Déclaration introuvable.' });

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
