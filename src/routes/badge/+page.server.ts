import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getRfidUid, regenerateRfidUid } from '$lib/server/authentikAdmin';
import { logAuditEvent } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

function resolvePk(locals: App.Locals): number {
	if (!locals.user) {
		redirect(302, '/login');
	}
	const pk = authentikPk(locals.user);
	if (!pk) {
		error(500, 'Impossible de résoudre votre identifiant Authentik (sub).');
	}
	return pk;
}

export const load: PageServerLoad = async ({ locals }) => {
	const pk = resolvePk(locals);

	// First visit: no rfid_uid attribute yet on this Authentik user, so provision one now
	// rather than showing an empty badge identifier.
	const uuid = (await getRfidUid(pk)) ?? (await regenerateRfidUid(pk));

	return { uuid };
};

export const actions: Actions = {
	regenerate: async ({ locals }) => {
		const pk = resolvePk(locals);
		const user = locals.user!;
		const uuid = await regenerateRfidUid(pk);

		// Deliberately no `details` — the badge UUID is a live physical-access credential, not
		// something to duplicate into the audit log even as a "before" value. Just the fact that a
		// regeneration happened, same posture as emergency contacts elsewhere in this feature.
		logAuditEvent({ sub: user.sub, label: displayName(user) }, 'user', 'badge.regenerate', { pk });

		return { success: true, uuid };
	}
};
