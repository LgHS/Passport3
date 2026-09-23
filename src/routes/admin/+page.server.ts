import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listUsers, AuthentikUnavailableError } from '$lib/server/authentikAdmin';
import { refreshMattermostCache } from '$lib/server/mattermost';
import { requireAdmin } from '$lib/server/auth';

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

export const actions: Actions = {
	refreshMattermostCache: async ({ locals }) => {
		requireAdmin(locals);
		try {
			await refreshMattermostCache();
		} catch {
			return fail(500, {
				mattermostCacheError: 'La régénération du cache Mattermost a échoué, réessayez.'
			});
		}
		return { mattermostCacheRefreshed: true };
	}
};
