import { getDb } from '$lib/server/db';

// The birthday_settings table itself is created (and seeded with its one row) by
// src/lib/server/migrations.ts (run once from db.ts's getDb()) — see that file's migration 5.

export interface BirthdaySettings {
	enabled: boolean;
	// 0-23, interpreted as Europe/Brussels local time by the scheduler — not UTC, since that's
	// what an admin typing "9" actually means.
	hour: number;
}

export async function getBirthdaySettings(): Promise<BirthdaySettings> {
	const sql = await getDb();
	const [row] = await sql<{ enabled: boolean; hour: number }[]>`
		SELECT enabled, hour FROM birthday_settings WHERE id = 1
	`;
	return { enabled: row.enabled, hour: row.hour };
}

export async function updateBirthdaySettings(settings: BirthdaySettings): Promise<void> {
	const sql = await getDb();
	await sql`UPDATE birthday_settings SET enabled = ${settings.enabled}, hour = ${settings.hour} WHERE id = 1`;
}
