import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin, requireAdminUser } from '$lib/server/auth';
import { getAvatarInfoByEmailHash } from '$lib/server/authentikAdmin';
import { pregenerateAvatars } from '$lib/server/avatars';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, type AppUser } from '$lib/types';
import { getBirthdaySettings, updateBirthdaySettings } from '$lib/server/birthdaySettings';
import { refreshMattermostCache } from '$lib/server/mattermost';
import { getSetting, setSetting, SETTING_KEYS, type SettingKey } from '$lib/server/appSettings';
import { env } from '$env/dynamic/private';
import { getRecapSchedule } from '$lib/server/taskAnnouncements';

// Mattermost channel ids are 26 lowercase alphanumerics.
const CHANNEL_ID_RE = /^[a-z0-9]{26}$/;

// Wishlist switches: form field name → setting key.
const WISHLIST_SWITCHES = {
	announce: SETTING_KEYS.wishlistAnnounce,
	announceGranted: SETTING_KEYS.wishlistAnnounceGranted,
	announceRejected: SETTING_KEYS.wishlistAnnounceRejected
} as const;

// Todolist switches: form field name → setting key.
const TASK_SWITCHES = {
	announceCreated: SETTING_KEYS.tasksAnnounceCreated,
	announceDone: SETTING_KEYS.tasksAnnounceDone,
	announceBlocked: SETTING_KEYS.tasksAnnounceBlocked,
	announceUrgent: SETTING_KEYS.tasksAnnounceUrgent,
	weeklyRecap: SETTING_KEYS.tasksWeeklyRecap
} as const;

async function readSwitches<T extends Record<string, SettingKey>>(switches: T): Promise<Record<keyof T, boolean>> {
	const entries = await Promise.all(
		Object.entries(switches).map(async ([field, key]) => [field, (await getSetting(key)) === 'true'] as const)
	);
	return Object.fromEntries(entries) as Record<keyof T, boolean>;
}

// Saves a block's switches and channel, audited with before/after.
async function saveAnnouncements(
	formData: FormData,
	switches: Record<string, SettingKey>,
	channelKey: SettingKey,
	channel: string,
	admin: AppUser,
	action: string,
	// Other fields of the same block, added to the audit entry.
	extra: { before: Record<string, unknown>; after: Record<string, unknown> } = { before: {}, after: {} }
): Promise<void> {
	const before: Record<string, unknown> = {
		channel: await getSetting(channelKey),
		...(await readSwitches(switches)),
		...extra.before
	};
	const after: Record<string, unknown> = { channel: channel || null, ...extra.after };
	for (const [field, key] of Object.entries(switches)) {
		after[field] = formData.has(field);
		await setSetting(key, after[field] ? 'true' : null);
	}
	await setSetting(channelKey, channel || null);
	await logAuditEvent({ sub: admin.sub, label: displayName(admin) }, 'admin', action, {}, { before, after });
}

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	const [birthdaySettings, birthdayChannel, wishlistChannel, tasksChannel] = await Promise.all([
		getBirthdaySettings(),
		getSetting(SETTING_KEYS.birthdayChannel),
		getSetting(SETTING_KEYS.wishlistChannel),
		getSetting(SETTING_KEYS.tasksChannel)
	]);
	const [wishlistAnnounce, tasksAnnounce, tasksRecap] = await Promise.all([
		readSwitches(WISHLIST_SWITCHES),
		readSwitches(TASK_SWITCHES),
		getRecapSchedule()
	]);
	return {
		birthdaySettings,
		mattermostChannels: {
			// The .env value is shown as the current one until a channel is picked here.
			birthday: birthdayChannel ?? env.MATTERMOST_BIRTHDAY_CHANNEL_ID ?? '',
			wishlist: wishlistChannel ?? '',
			tasks: tasksChannel ?? ''
		},
		wishlistAnnounce,
		tasksAnnounce,
		tasksRecap
	};
};

const INVALID_CHANNEL = 'Identifiant de canal invalide (26 caractères, minuscules et chiffres).';

export const actions: Actions = {
	// Birthday block: on/off, hour, and the channel they're posted to.
	updateBirthdaySettings: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);

		const formData = await request.formData();
		const enabled = formData.has('enabled');
		const hour = Number(formData.get('hour'));
		const channel = String(formData.get('birthdayChannel') ?? '').trim();

		if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
			return fail(400, { birthdayError: 'Heure invalide (0 à 23).', enabled, hour });
		}
		if (channel && !CHANNEL_ID_RE.test(channel)) {
			return fail(400, { birthdayError: INVALID_CHANNEL, enabled, hour });
		}

		const before = { ...(await getBirthdaySettings()), channel: await getSetting(SETTING_KEYS.birthdayChannel) };
		await updateBirthdaySettings({ enabled, hour });
		await setSetting(SETTING_KEYS.birthdayChannel, channel || null);
		await logAuditEvent({ sub: admin.sub, label: displayName(admin) }, 'admin', 'settings.birthday.update', {}, {
			before,
			after: { enabled, hour, channel: channel || null }
		});

		return { birthdaySuccess: true, enabled, hour };
	},

	// Wishlist block: which events are announced on Mattermost, and where.
	updateWishlistSettings: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);
		const formData = await request.formData();
		const channel = String(formData.get('wishlistChannel') ?? '').trim();
		if (channel && !CHANNEL_ID_RE.test(channel)) {
			return fail(400, { wishlistError: INVALID_CHANNEL });
		}

		await saveAnnouncements(formData, WISHLIST_SWITCHES, SETTING_KEYS.wishlistChannel, channel, admin, 'settings.wishlist.update');
		return { wishlistSaved: true };
	},

	// Todolist block: which task events are announced on Mattermost, the weekly recap, and where.
	updateTaskSettings: async ({ request, locals }) => {
		const admin = requireAdminUser(locals);
		const formData = await request.formData();
		const channel = String(formData.get('tasksChannel') ?? '').trim();
		if (channel && !CHANNEL_ID_RE.test(channel)) {
			return fail(400, { tasksError: INVALID_CHANNEL });
		}
		const recapDay = Number(formData.get('recapDay'));
		const recapHour = Number(formData.get('recapHour'));
		if (!Number.isInteger(recapDay) || recapDay < 0 || recapDay > 6) {
			return fail(400, { tasksError: 'Jour du récap invalide.' });
		}
		if (!Number.isInteger(recapHour) || recapHour < 0 || recapHour > 23) {
			return fail(400, { tasksError: 'Heure du récap invalide (0 à 23).' });
		}
		const recapBefore = await getRecapSchedule();
		await setSetting(SETTING_KEYS.tasksRecapDay, String(recapDay));
		await setSetting(SETTING_KEYS.tasksRecapHour, String(recapHour));
		await saveAnnouncements(formData, TASK_SWITCHES, SETTING_KEYS.tasksChannel, channel, admin, 'settings.tasks.update', {
			before: { recapDay: recapBefore.day, recapHour: recapBefore.hour },
			after: { recapDay, recapHour }
		});
		return { tasksSaved: true };
	},

	refreshMattermostCache: async ({ locals }) => {
		requireAdmin(locals);
		try {
			await refreshMattermostCache();
		} catch {
			return fail(500, {
				mattermostCacheError: 'La régénération du cache Mattermost a échoué, réessaie.'
			});
		}
		return { mattermostCacheRefreshed: true };
	},

	pregenerateAvatars: async ({ locals }) => {
		const admin = requireAdminUser(locals);
		let result;
		try {
			result = await pregenerateAvatars(await getAvatarInfoByEmailHash(true));
		} catch {
			return fail(500, { avatarsError: 'La génération des avatars a échoué, réessaie.' });
		}
		if (result.generated > 0) {
			await logAuditEvent({ sub: admin.sub, label: displayName(admin) }, 'admin', 'avatars.pregenerate', {}, {
				generated: result.generated
			});
		}
		return { avatarsGenerated: result };
	}
};
