import { getDb } from '$lib/server/db';

// The birthday_settings table itself is created (and seeded with its one row) by
// src/lib/server/migrations.ts (run once from db.ts's getDb()) — see that file's migration 1.

export interface BirthdaySettings {
	enabled: boolean;
	// 0-23, interpreted as Europe/Brussels local time by the scheduler — not UTC, since that's
	// what an admin typing "9" actually means.
	hour: number;
}

export function getBirthdaySettings(): BirthdaySettings {
	const row = getDb()
		.prepare('SELECT enabled, hour FROM birthday_settings WHERE id = 1')
		.get() as { enabled: number; hour: number };
	return { enabled: row.enabled === 1, hour: row.hour };
}

export function updateBirthdaySettings(settings: BirthdaySettings): void {
	getDb()
		.prepare('UPDATE birthday_settings SET enabled = ?, hour = ? WHERE id = 1')
		.run(settings.enabled ? 1 : 0, settings.hour);
}
