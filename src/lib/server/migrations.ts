import type postgres from 'postgres';

interface Migration {
	version: number;
	name: string;
	up: (sql: postgres.TransactionSql) => Promise<void>;
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
		up: async (sql) => {
			await sql`
				CREATE TABLE audit_events (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					actor_sub TEXT NOT NULL,
					actor_label TEXT NOT NULL,
					action TEXT NOT NULL,
					target_pk INTEGER,
					target_email TEXT,
					details TEXT
				)
			`;
			// Speeds up listAuditEventsForTarget()'s WHERE target_pk = ? ORDER BY id DESC — without
			// it, that query is a full table scan. Negligible today, but cheap before the table grows.
			await sql`CREATE INDEX audit_events_target_pk_id ON audit_events(target_pk, id DESC)`;
		}
	},
	{
		version: 2,
		name: 'add audit_events.source',
		up: async (sql) => {
			// 'admin' backfill for every pre-existing row: this column didn't exist before the
			// admin/user distinction did, so every row logged before it shipped was an admin action.
			await sql`ALTER TABLE audit_events ADD COLUMN source TEXT NOT NULL DEFAULT 'admin'`;
		}
	},
	{
		version: 3,
		name: 'create wishlist_items and wishlist_votes',
		up: async (sql) => {
			await sql`
				CREATE TABLE wishlist_items (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					author_sub TEXT NOT NULL,
					author_label TEXT NOT NULL,
					title TEXT NOT NULL,
					description TEXT,
					link TEXT,
					quantity INTEGER NOT NULL DEFAULT 1,
					-- DOUBLE PRECISION, not REAL: Postgres' REAL is 4 bytes (~7 significant digits),
					-- unlike SQLite's 8-byte REAL this column was first written for.
					estimated_amount DOUBLE PRECISION,
					type TEXT NOT NULL
				)
			`;
			// References wishlist_items, so must be created after it. Postgres enforces foreign keys
			// unconditionally (unlike SQLite, which needed `PRAGMA foreign_keys = ON`).
			await sql`
				CREATE TABLE wishlist_votes (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
					voter_sub TEXT NOT NULL,
					voter_label TEXT NOT NULL,
					value INTEGER NOT NULL,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					UNIQUE(item_id, voter_sub)
				)
			`;
		}
	},
	{
		version: 4,
		name: 'add wishlist_items.status and resolved_at',
		up: async (sql) => {
			// Every pre-existing row predates resolution, hence the 'pending' default/backfill.
			await sql`ALTER TABLE wishlist_items ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`;
			await sql`ALTER TABLE wishlist_items ADD COLUMN resolved_at TIMESTAMPTZ`;
		}
	},
	{
		// Renumbered from birthday-scheduler's own 1/2 to continue after audit-log/wishlist's 1-4 —
		// these were developed on sibling branches that each numbered from 1 independently. See
		// the migrations backfill TODO in project memory for why this collision was expected.
		version: 5,
		name: 'create birthday_settings',
		up: async (sql) => {
			// Single-row settings table (CHECK(id = 1) keeps it that way) rather than a generic
			// key/value table — there's exactly one setting pair to store today.
			await sql`
				CREATE TABLE birthday_settings (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					enabled BOOLEAN NOT NULL DEFAULT false,
					hour INTEGER NOT NULL DEFAULT 9
				)
			`;
			await sql`INSERT INTO birthday_settings (id, enabled, hour) VALUES (1, false, 9)`;
		}
	},
	{
		version: 6,
		name: 'create birthday_sent',
		up: async (sql) => {
			await sql`
				CREATE TABLE birthday_sent (
					member_pk INTEGER NOT NULL,
					year INTEGER NOT NULL,
					sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					PRIMARY KEY (member_pk, year)
				)
			`;
		}
	},
	{
		version: 7,
		name: 'create member_avatars',
		up: async (sql) => {
			// One row per member who uploaded a photo — no row means "show generated initials". The
			// file is named after the md5 hash of the member's email (see avatars.ts), so Authentik
			// and BookStack can reference it from the email alone, like a Gravatar.
			await sql`
				CREATE TABLE member_avatars (
					member_pk INTEGER PRIMARY KEY,
					file TEXT NOT NULL,
					updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
				)
			`;
		}
	},
	{
		version: 8,
		name: 'create avatar_variants',
		up: async (sql) => {
			// Background colour picked by a member for their generated initials avatar ("Changer de
			// couleur" on /profile), keyed by the same email hash as the avatar URL. No row means the
			// default colour derived from the hash itself.
			await sql`
				CREATE TABLE avatar_variants (
					email_hash TEXT PRIMARY KEY,
					variant INTEGER NOT NULL
				)
			`;
		}
	}
];

// Arbitrary, fixed constant identifying Passport3's own migration lock — only matters if another
// application ever takes an advisory lock with this exact number on the very same Postgres
// instance, which isn't the case here.
const MIGRATION_LOCK_ID = 727300001;

export async function runMigrations(sql: postgres.Sql): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`;

	const sorted = [...migrations].sort((a, b) => a.version - b.version);
	for (const migration of sorted) {
		await sql.begin(async (tx) => {
			// Held only for this transaction, released automatically on commit/rollback. Guards
			// against two processes starting at the same time (a redeploy, more than one replica) both
			// applying the same migration — db.ts's promise memoization only protects a single
			// process, this is the cross-process equivalent.
			await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;

			// Re-read after acquiring the lock, not before: another process may have applied this
			// exact migration while this one was waiting for the lock.
			const [already] = await tx<{ version: number }[]>`
				SELECT version FROM schema_migrations WHERE version = ${migration.version}
			`;
			if (already) return;

			await migration.up(tx);
			await tx`INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, ${migration.name})`;
		});
	}
}
