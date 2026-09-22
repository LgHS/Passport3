import { getDb } from '$lib/server/db';

// Lazy, idempotent — same rationale as db.ts's own lazy connection and auditLog.ts's schema
// setup: owning this table is this module's job, but nothing should run just from importing it.
let schemaReady = false;

function ensureSchema(): void {
	if (schemaReady) return;
	const db = getDb();
	// Single-row settings table (CHECK(id = 1) keeps it that way) rather than a generic key/value
	// table — there's exactly one setting pair to store today, no need for a more general shape.
	db.exec(`
		CREATE TABLE IF NOT EXISTS birthday_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			enabled INTEGER NOT NULL DEFAULT 0,
			hour INTEGER NOT NULL DEFAULT 9
		)
	`);
	db.exec(`INSERT OR IGNORE INTO birthday_settings (id, enabled, hour) VALUES (1, 0, 9)`);
	schemaReady = true;
}

export interface BirthdaySettings {
	enabled: boolean;
	// 0-23, interpreted as Europe/Brussels local time by the scheduler — not UTC, since that's
	// what an admin typing "9" actually means.
	hour: number;
}

export function getBirthdaySettings(): BirthdaySettings {
	ensureSchema();
	const row = getDb()
		.prepare('SELECT enabled, hour FROM birthday_settings WHERE id = 1')
		.get() as { enabled: number; hour: number };
	return { enabled: row.enabled === 1, hour: row.hour };
}

export function updateBirthdaySettings(settings: BirthdaySettings): void {
	ensureSchema();
	getDb()
		.prepare('UPDATE birthday_settings SET enabled = ?, hour = ? WHERE id = 1')
		.run(settings.enabled ? 1 : 0, settings.hour);
}
