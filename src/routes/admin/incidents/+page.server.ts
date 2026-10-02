import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin, requireAdminUser } from '$lib/server/auth';
import { listIncidents, restoreIncident, softDeleteIncident } from '$lib/server/incidents';
import { listIncidentPhotos } from '$lib/server/incidentPhotos';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, type AppUser } from '$lib/types';

// Declarations filed on /incidents, admin-only (also enforced by admin/+layout.server.ts).
export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const incidents = await listIncidents();
	return { incidents: incidents.map((incident) => ({ ...incident, photos: listIncidentPhotos(incident.id) })) };
};

// The declaration's own author is the audit entry's target, so the action shows up in that member's
// own history on /profile and not only in the admin log. Details stay as sparse as
// incident.create's: the id and the kind, never what the declaration said.
async function recordIncidentAction(
	admin: AppUser,
	action: 'incident.delete' | 'incident.restore',
	incidentId: number,
	target: { authorSub: string; kind: string }
): Promise<void> {
	const authorPk = Number(target.authorSub);
	await logAuditEvent(
		{ sub: admin.sub, label: displayName(admin) },
		'admin',
		action,
		Number.isInteger(authorPk) && authorPk > 0 ? { pk: authorPk } : {},
		{ incidentId, kind: target.kind }
	);
}

function incidentIdFrom(formData: FormData): number | null {
	const id = Number(formData.get('incidentId'));
	return Number.isInteger(id) && id >= 1 ? id : null;
}

export const actions: Actions = {
	// Hides a mistaken or duplicate declaration. Nothing is destroyed: the row and its photos stay,
	// and the list can show removed declarations on demand. These declarations are required for
	// legal and insurance reasons, so an admin must not be able to make one disappear for good.
	delete: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);
		const id = incidentIdFrom(await request.formData());
		if (id === null) return fail(400, { error: 'Requête invalide.' });

		const deleted = await softDeleteIncident(id, { sub: admin.sub, label: displayName(admin) });
		// Also covers a declaration already removed, so a double submission doesn't rewrite who
		// removed it.
		if (!deleted) return fail(404, { error: 'Déclaration introuvable.' });

		await recordIncidentAction(admin, 'incident.delete', id, deleted);
		return { deleted: true };
	},

	// Puts one back, for a removal made by mistake.
	restore: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);
		const id = incidentIdFrom(await request.formData());
		if (id === null) return fail(400, { error: 'Requête invalide.' });

		const restored = await restoreIncident(id);
		// Unknown, or already in the list: nothing changed, so nothing is logged.
		if (!restored) return fail(404, { error: 'Déclaration introuvable.' });

		await recordIncidentAction(admin, 'incident.restore', id, restored);
		return { restored: true };
	}
};
