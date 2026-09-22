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
		name: 'create audit_events',
		up: (db) => {
			db.exec(`
				CREATE TABLE audit_events (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
					actor_sub TEXT NOT NULL,
					actor_label TEXT NOT NULL,
					action TEXT NOT NULL,
					target_pk INTEGER,
					target_email TEXT,
					details TEXT
				)
			`);
			// Speeds up listAuditEventsForTarget()'s WHERE target_pk = ? ORDER BY id DESC — without
			// it, that query is a full table scan. Negligible today, but cheap before the table grows.
			db.exec(`CREATE INDEX audit_events_target_pk_id ON audit_events(target_pk, id DESC)`);
		}
	},
	{
		version: 2,
		name: 'add audit_events.source',
		up: (db) => {
			// 'admin' backfill for every pre-existing row: this column didn't exist before the
			// admin/user distinction did, so every row logged before it shipped was an admin action.
			db.exec(`ALTER TABLE audit_events ADD COLUMN source TEXT NOT NULL DEFAULT 'admin'`);
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
