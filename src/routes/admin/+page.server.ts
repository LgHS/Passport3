import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listUsers, AuthentikUnavailableError } from '$lib/server/authentikAdmin';

const AUTHENTIK_UNAVAILABLE_MESSAGE = 'Service temporairement indisponible. Réessayez dans quelques instants.';

export const load: PageServerLoad = async () => {
	try {
		return { users: await listUsers() };
	} catch (err) {
		if (err instanceof AuthentikUnavailableError) {
			error(503, AUTHENTIK_UNAVAILABLE_MESSAGE);
		}
		throw err;
	}
};
