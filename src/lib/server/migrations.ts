import type Database from 'better-sqlite3';

interface Migration {
	version: number;
	name: string;
	up: (db: Database.Database) => void;
}

// Append-only: a migration that already shipped must never be edited, reordered, or removed — a
// fresh deploy and an already-running one both have to end up applying the exact same sequence in
// the same order. Fixing a mistake in an already-shipped migration means adding a new one that
// corrects it, not editing the old entry. Add a feature's table here instead of a module-local
// `CREATE TABLE IF NOT EXISTS` — see PR #46's review for why: one place to see what tables exist
// and in what order they were introduced, instead of each module quietly rolling its own.
const migrations: Migration[] = [
	{
		version: 1,
		name: 'create birthday_settings',
		up: (db) => {
			// Single-row settings table (CHECK(id = 1) keeps it that way) rather than a generic
			// key/value table — there's exactly one setting pair to store today.
			db.exec(`
				CREATE TABLE birthday_settings (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					enabled INTEGER NOT NULL DEFAULT 0,
					hour INTEGER NOT NULL DEFAULT 9
				)
			`);
			db.exec('INSERT INTO birthday_settings (id, enabled, hour) VALUES (1, 0, 9)');
		}
	},
	{
		version: 2,
		name: 'create birthday_sent',
		up: (db) => {
			db.exec(`
				CREATE TABLE birthday_sent (
					member_pk INTEGER NOT NULL,
					year INTEGER NOT NULL,
					sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
					PRIMARY KEY (member_pk, year)
				)
			`);
		}
	}
];

export function runMigrations(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		)
	`);

	const applied = new Set(
		(db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
			(row) => row.version
		)
	);

	const pending = [...migrations].sort((a, b) => a.version - b.version);
	for (const migration of pending) {
		if (applied.has(migration.version)) continue;
		db.transaction(() => {
			migration.up(db);
			db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
				migration.version,
				migration.name
			);
		})();
	}
}
