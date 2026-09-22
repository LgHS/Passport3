import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listUsers } from '$lib/server/authentikAdmin';
import { refreshMattermostCache } from '$lib/server/mattermost';
import { requireAdmin } from '$lib/server/auth';

export const load: PageServerLoad = async () => {
	return { users: await listUsers() };
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
