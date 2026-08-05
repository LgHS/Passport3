import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createInvitation } from '$lib/server/authentikAdmin';
import { requireAdmin } from '$lib/server/auth';

const DEFAULT_EXPIRY_MS = 48 * 60 * 60 * 1000;

export const actions: Actions = {
	default: async ({ request, locals }) => {
		requireAdmin(locals);

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

		return { success: true, email, inviteUrl };
	}
};
