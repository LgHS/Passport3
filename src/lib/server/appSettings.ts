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
	wishlistAnnounceRejected: 'mattermost.wishlist_announce_rejected_enabled'
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
