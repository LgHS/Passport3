import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin, requireAdminUser } from '$lib/server/auth';
import { getInitialsByEmailHash } from '$lib/server/authentikAdmin';
import { pregenerateAvatars } from '$lib/server/avatars';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';
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
	},

	pregenerateAvatars: async ({ locals }) => {
		const admin = requireAdminUser(locals);
		let result;
		try {
			result = await pregenerateAvatars(await getInitialsByEmailHash(true));
		} catch {
			return fail(500, { avatarsError: 'La génération des avatars a échoué, réessayez.' });
		}
		if (result.generated > 0) {
			logAuditEvent({ sub: admin.sub, label: displayName(admin) }, 'admin', 'avatars.pregenerate', {}, {
				generated: result.generated
			});
		}
		return { avatarsGenerated: result };
	}
};
