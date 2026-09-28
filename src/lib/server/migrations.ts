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
	},
	{
		version: 9,
		name: 'drop member_avatars and avatar_variants',
		up: async (sql) => {
			// Avatars no longer use the database at all (see avatars.ts): whether a member uploaded
			// a photo is read from the disk, and their chosen colour is an Authentik attribute.
			await sql`DROP TABLE member_avatars`;
			await sql`DROP TABLE avatar_variants`;
		}
	},
	{
		version: 10,
		name: 'create tasks',
		up: async (sql) => {
			// First shape of the task board (one assignee per task). Kept exactly as it first ran:
			// migration 11 below turns it into the current shape.
			await sql`
				CREATE TABLE tasks (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					author_sub TEXT NOT NULL,
					author_label TEXT NOT NULL,
					title TEXT NOT NULL,
					description TEXT,
					due_date DATE,
					status TEXT NOT NULL DEFAULT 'todo',
					assignee_sub TEXT,
					assignee_label TEXT,
					assigned_by_sub TEXT,
					done_at TIMESTAMPTZ
				)
			`;
		}
	},
	{
		version: 11,
		name: 'tasks: several members, leader, blocked state',
		up: async (sql) => {
			// Written to work on any database that ran a draft of migration 10 (whichever shape it
			// had), hence the IF [NOT] EXISTS everywhere.
			// Everyone on a task: volunteers (assigned_by_sub null) and members an admin put on it
			// (assigned_by_sub set — they can't remove themselves). At most one leader per task.
			await sql`
				CREATE TABLE IF NOT EXISTS task_members (
					task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
					member_sub TEXT NOT NULL,
					member_label TEXT NOT NULL,
					assigned_by_sub TEXT,
					is_leader BOOLEAN NOT NULL DEFAULT false,
					joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					PRIMARY KEY (task_id, member_sub)
				)
			`;
			await sql`
				CREATE UNIQUE INDEX IF NOT EXISTS task_members_one_leader ON task_members(task_id) WHERE is_leader
			`;

			// The single assignee of the first shape becomes the task's first member.
			const [{ has_assignee }] = await sql<{ has_assignee: boolean }[]>`
				SELECT EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_name = 'tasks' AND column_name = 'assignee_sub'
				) AS has_assignee
			`;
			if (has_assignee) {
				await sql`
					INSERT INTO task_members (task_id, member_sub, member_label, assigned_by_sub)
					SELECT id, assignee_sub, assignee_label, assigned_by_sub FROM tasks WHERE assignee_sub IS NOT NULL
					ON CONFLICT DO NOTHING
				`;
			}
			// "à faire" vs "en cours" is now derived from whether anyone is on the task, and "fait"
			// from done_at.
			await sql`
				ALTER TABLE tasks
					DROP COLUMN IF EXISTS status,
					DROP COLUMN IF EXISTS assignee_sub,
					DROP COLUMN IF EXISTS assignee_label,
					DROP COLUMN IF EXISTS assigned_by_sub,
					-- 'internal' (waiting on us: a decision, a purchase…) or 'external' (a supplier, a
					-- third party…), with a note saying what it's waiting on. NULL = not blocked.
					ADD COLUMN IF NOT EXISTS blocked_kind TEXT,
					ADD COLUMN IF NOT EXISTS blocked_note TEXT
			`;
		}
	},
	{
		version: 12,
		name: 'tasks: explicit start, per-task history',
		up: async (sql) => {
			// People on a task doesn't mean it has started: "en cours" is now an explicit step
			// ("Démarrer"), recorded here. NULL = not started.
			await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`;
			// Each task's own history, shown in its modal. Every entry is also written to
			// audit_events (see /tasks' +page.server.ts): this one is per task and goes away with it,
			// the audit log keeps everything.
			await sql`
				CREATE TABLE IF NOT EXISTS task_events (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					actor_label TEXT NOT NULL,
					action TEXT NOT NULL,
					details TEXT
				)
			`;
			await sql`CREATE INDEX IF NOT EXISTS task_events_task_id ON task_events(task_id, id)`;
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
