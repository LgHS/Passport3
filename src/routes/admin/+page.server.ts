import type { Actions, PageServerLoad } from './$types';
import { listUsers } from '$lib/server/authentikAdmin';
import { invalidateMattermostCache } from '$lib/server/mattermost';
import { requireAdmin } from '$lib/server/auth';

export const load: PageServerLoad = async () => {
	return { users: await listUsers() };
};

export const actions: Actions = {
	refreshMattermostCache: async ({ locals }) => {
		requireAdmin(locals);
		invalidateMattermostCache();
		return { mattermostCacheRefreshed: true };
	}
};
