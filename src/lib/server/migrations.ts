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
	},
	{
		version: 3,
		name: 'create wishlist_items and wishlist_votes',
		up: (db) => {
			db.exec(`
				CREATE TABLE wishlist_items (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
					author_sub TEXT NOT NULL,
					author_label TEXT NOT NULL,
					title TEXT NOT NULL,
					description TEXT,
					link TEXT,
					quantity INTEGER NOT NULL DEFAULT 1,
					estimated_amount REAL,
					type TEXT NOT NULL
				)
			`);
			// References wishlist_items, so must be created after it — foreign_keys is ON.
			db.exec(`
				CREATE TABLE wishlist_votes (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
					voter_sub TEXT NOT NULL,
					voter_label TEXT NOT NULL,
					value INTEGER NOT NULL,
					created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
					UNIQUE(item_id, voter_sub)
				)
			`);
		}
	},
	{
		version: 4,
		name: 'add wishlist_items.status and resolved_at',
		up: (db) => {
			// Every pre-existing row predates resolution, hence the 'pending' default/backfill.
			db.exec(`ALTER TABLE wishlist_items ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`);
			db.exec(`ALTER TABLE wishlist_items ADD COLUMN resolved_at TEXT`);
		}
	},
	{
		// Renumbered from birthday-scheduler's own 1/2 to continue after audit-log/wishlist's 1-4 —
		// these were developed on sibling branches that each numbered from 1 independently. See
		// the migrations backfill TODO in project memory for why this collision was expected.
		version: 5,
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
		version: 6,
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
	},
	{
		version: 7,
		name: 'create member_avatars',
		up: (db) => {
			// One row per member who uploaded a photo — no row means "fall back to Gravatar". The
			// file is named after the md5 hash of the member's email (see avatars.ts), so Authentik
			// and BookStack can reference it the same way they reference a Gravatar.
			db.exec(`
				CREATE TABLE member_avatars (
					member_pk INTEGER PRIMARY KEY,
					file TEXT NOT NULL,
					updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
