import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listUsers, listUserPksWithMfa, AuthentikUnavailableError } from '$lib/server/authentikAdmin';

const AUTHENTIK_UNAVAILABLE_MESSAGE = 'Service temporairement indisponible. Réessaie dans quelques instants.';

export const load: PageServerLoad = async () => {
	try {
		const [users, mfaPks] = await Promise.all([
			listUsers(),
			// Best-effort: the member list is still useful without this column. null (not false)
			// on failure — "couldn't check" must stay distinguishable from "no MFA", see
			// feedback_distinguish-fetch-failure-from-empty.
			listUserPksWithMfa().catch((err) => {
				console.error('Failed to list MFA devices', err);
				return null;
			})
		]);
		return { users: users.map((user) => ({ ...user, hasMfa: mfaPks ? mfaPks.has(user.pk) : null })) };
	} catch (err) {
		if (err instanceof AuthentikUnavailableError) {
			error(503, AUTHENTIK_UNAVAILABLE_MESSAGE);
		}
		throw err;
	}
};
