import { getDb } from '$lib/server/db';

// Small admin-editable settings (table app_settings, migration 16), edited on /admin/settings.

export const SETTING_KEYS = {
	// Birthday announcements: "true" when on, the hour (0-23, Brussels), and the channel.
	birthdayEnabled: 'mattermost.birthday_enabled',
	birthdayHour: 'mattermost.birthday_hour',
	birthdayChannel: 'mattermost.birthday_channel_id',
	wishlistChannel: 'mattermost.wishlist_channel_id',
	// "true" when new wishlist proposals are announced (off by default, like birthdays).
	wishlistAnnounce: 'mattermost.wishlist_announce_enabled',
	// Same, for proposals an admin grants or turns down.
	wishlistAnnounceGranted: 'mattermost.wishlist_announce_granted_enabled',
	wishlistAnnounceRejected: 'mattermost.wishlist_announce_rejected_enabled',
	// Task board: its channel, one switch per announced event, and the weekly recap.
	tasksChannel: 'mattermost.tasks_channel_id',
	tasksAnnounceCreated: 'mattermost.tasks_announce_created_enabled',
	tasksAnnounceDone: 'mattermost.tasks_announce_done_enabled',
	tasksAnnounceBlocked: 'mattermost.tasks_announce_blocked_enabled',
	tasksAnnounceUrgent: 'mattermost.tasks_announce_urgent_enabled',
	tasksWeeklyRecap: 'mattermost.tasks_weekly_recap_enabled',
	// Recap day (0 = Sunday … 6 = Saturday, default Monday) and hour (Brussels, default 9).
	tasksRecapDay: 'mattermost.tasks_recap_day',
	tasksRecapHour: 'mattermost.tasks_recap_hour',
	// Brussels date (YYYY-MM-DD) the last recap went out, so it's sent once a week.
	tasksRecapLastSent: 'mattermost.tasks_recap_last_sent',
	// Treasury (comptaNotifications.ts): its channel and one switch per announced event.
	comptaChannel: 'mattermost.compta_channel_id',
	comptaAnnounceReception: 'mattermost.compta_announce_reception_enabled',
	comptaAnnounceNotesDeFrais: 'mattermost.compta_announce_notes_de_frais_enabled',
	comptaAnnounceEchues: 'mattermost.compta_announce_echues_enabled',
	comptaAnnounceAbonnements: 'mattermost.compta_announce_abonnements_enabled',
	// Brussels date (YYYY-MM-DD) the last overdue-invoices digest went out, so it's sent once a week.
	comptaEchuesLastSent: 'mattermost.compta_echues_last_sent'
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export async function getSetting(key: SettingKey): Promise<string | null> {
	const sql = await getDb();
	const [row] = await sql<{ value: string }[]>`SELECT value FROM app_settings WHERE key = ${key}`;
	return row?.value || null;
}

// `value` null or empty removes the setting.
export async function setSetting(key: SettingKey, value: string | null): Promise<void> {
	const sql = await getDb();
	if (!value) {
		await sql`DELETE FROM app_settings WHERE key = ${key}`;
		return;
	}
	await sql`
		INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`;
}
