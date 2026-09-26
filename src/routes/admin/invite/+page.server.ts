import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createInvitation } from '$lib/server/authentikAdmin';
import { requireAdminUser } from '$lib/server/auth';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

const DEFAULT_EXPIRY_MS = 48 * 60 * 60 * 1000;

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);

		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();
		const singleUse = formData.get('single_use') === 'on';
		const expires = String(formData.get('expires') ?? '').trim();

		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { error: 'Adresse email invalide.', email, singleUse });
		}

		const expiresAt = expires
			? new Date(expires).toISOString()
			: new Date(Date.now() + DEFAULT_EXPIRY_MS).toISOString();

		const { inviteUrl } = await createInvitation({ email, singleUse, expiresAt });

		await logAuditEvent(
			{ sub: admin.sub, label: displayName(admin) },
			'admin',
			'invitation.create',
			{ email },
			{ singleUse, expiresAt }
		);

		return { success: true, email, inviteUrl };
	}
};
