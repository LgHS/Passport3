import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createIncident, listIncidents } from '$lib/server/incidents';
import { validateIncidentSubmission } from '$lib/server/incidentValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, isAdmin, type AppUser } from '$lib/types';

function requireUser(locals: App.Locals): AppUser {
	if (!locals.user) {
		redirect(302, '/login');
	}
	return locals.user;
}

// Same convention as the wishlist and the task board: declarations are attributed by Authentik
// username, with displayName() as the fallback for an account that has none.
function usernameLabel(user: AppUser): string {
	return user.preferred_username ?? displayName(user);
}

// Same convention as everywhere else: the audit target is the member the entry is about, which for
// a declaration is the person who filed it. Subject mode makes sub the Authentik pk (see
// authentikPk() in $lib/types).
function targetFromSub(sub: string): { pk: number } | Record<string, never> {
	const pk = Number(sub);
	return Number.isInteger(pk) && pk > 0 ? { pk } : {};
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const admin = isAdmin(user);

	// `null` rather than an empty array for a non-admin: "you don't get to see these" and "there are
	// none yet" are different things, and the page says something different for each. Nothing is
	// fetched at all in that case — a declaration must never reach a non-admin's browser, not merely
	// be hidden once it's there.
	return {
		incidents: admin ? await listIncidents() : null,
		isAdmin: admin
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		const result = validateIncidentSubmission(await request.formData());
		if (!result.ok) {
			return fail(400, { error: result.error });
		}

		const incidentId = await createIncident(
			{ sub: user.sub, label: usernameLabel(user) },
			result.input
		);

		// Deliberately minimal details: the id and the kind, nothing else. A declaration can describe
		// someone's injury, who was hurt and what care they were given — none of that gets duplicated
		// into the audit log, which is readable by every admin and by the member on their own
		// /profile. Same posture as emergency contacts, logged as "changed" without their values.
		// Uniform for both kinds so there's never a judgement call about what counts as sensitive.
		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'incident.create',
			targetFromSub(user.sub),
			{ incidentId, kind: result.input.kind }
		);

		return { created: true };
	}
};
