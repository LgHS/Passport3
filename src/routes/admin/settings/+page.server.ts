import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { getBirthdaySettings, updateBirthdaySettings } from '$lib/server/birthdaySettings';
import { refreshMattermostCache } from '$lib/server/mattermost';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	return { birthdaySettings: getBirthdaySettings() };
};

export const actions: Actions = {
	updateBirthdaySettings: async ({ request, locals }) => {
		requireAdmin(locals);

		const formData = await request.formData();
		const enabled = formData.has('enabled');
		const hour = Number(formData.get('hour'));

		if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
			return fail(400, { birthdayError: 'Heure invalide (0 à 23).', enabled, hour });
		}

		updateBirthdaySettings({ enabled, hour });

		return { birthdaySuccess: true, enabled, hour };
	},

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
