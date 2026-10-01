import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createIncident } from '$lib/server/incidents';
import { validateIncidentSubmission } from '$lib/server/incidentValidation';
import { saveIncidentPhotos, validateIncidentPhotos } from '$lib/server/incidentPhotos';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, type AppUser } from '$lib/types';

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

// The declarations themselves are listed on /admin/incidents; this page only takes new ones.
export const load: PageServerLoad = async ({ locals }) => {
	requireUser(locals);
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const result = validateIncidentSubmission(formData);
		if (!result.ok) {
			return fail(400, { error: result.error });
		}
		const photos = await validateIncidentPhotos(formData);
		if (!photos.ok) {
			return fail(400, { error: photos.error });
		}

		const incidentId = await createIncident(
			{ sub: user.sub, label: usernameLabel(user) },
			result.input
		);
		// After the row exists, since the files are keyed by its id. A disk failure here doesn't
		// lose the declaration itself, only its photos — said so rather than reported as a failure.
		let photosSaved = true;
		try {
			saveIncidentPhotos(incidentId, photos.photos);
		} catch (err) {
			console.error(`[incidents] saving photos of #${incidentId} failed:`, err);
			photosSaved = false;
		}

		// Deliberately minimal details: the id, the kind and how many photos, nothing else. A declaration can describe
		// someone's injury, who was hurt and what care they were given — none of that gets duplicated
		// into the audit log, which is readable by every admin and by the member on their own
		// /profile. Same posture as emergency contacts, logged as "changed" without their values.
		// Uniform for both kinds so there's never a judgement call about what counts as sensitive.
		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'incident.create',
			targetFromSub(user.sub),
			{ incidentId, kind: result.input.kind, photos: photosSaved ? photos.photos.length : 0 }
		);

		return { created: true, photosSaved };
	}
};
