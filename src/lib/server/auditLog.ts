import { getDb } from '$lib/server/db';

// Any new action that mutates a member's account or admin-side data should call logAuditEvent()
// below, the same way every existing admin/*+page.server.ts and member self-service action does —
// see the README's "Audit log" section. This is also the single place a future Mattermost push
// for these events should hook in, rather than each of the ~15 call sites individually.

// Lazy, idempotent — same rationale as db.ts's own lazy connection: owning this table's schema is
// this module's job, but nothing should run just from importing it.
let schemaReady = false;

function ensureSchema(): void {
	if (schemaReady) return;
	const db = getDb();
	db.exec(`
		CREATE TABLE IF NOT EXISTS audit_events (
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

	// `source` was added after this table already shipped — CREATE TABLE IF NOT EXISTS above is a
	// no-op on a pre-existing file, so an already-deployed DB needs the column added explicitly.
	// Existing rows all predate the admin/user distinction, so they backfill as 'admin' (every
	// action logged before this column existed was an admin one).
	const hasSourceColumn = (db.pragma('table_info(audit_events)') as { name: string }[]).some(
		(col) => col.name === 'source'
	);
	if (!hasSourceColumn) {
		db.exec(`ALTER TABLE audit_events ADD COLUMN source TEXT NOT NULL DEFAULT 'admin'`);
	}

	// Speeds up listAuditEventsForTarget()'s WHERE target_pk = ? ORDER BY id DESC — without it,
	// that query is a full table scan. Negligible today, but cheap to have before the table grows.
	db.exec(`CREATE INDEX IF NOT EXISTS audit_events_target_pk_id ON audit_events(target_pk, id DESC)`);

	schemaReady = true;
}

// 'admin' = an admin acted on someone else's behalf (via /admin/*). 'user' = a member acted on
// their own account (via /profile, /badge, /cotisation, /trombinoscope, /github). The target is
// always set either way — for 'user' events it's the actor's own pk, so both kinds can be
// queried the same way (e.g. "everything that happened to member #21").
export type AuditSource = 'admin' | 'user';

export interface AuditActor {
	// Stable Authentik subject id — kept alongside the label in case the admin's display name
	// changes later, though nothing resolves it back to a live account today.
	sub: string;
	label: string;
}

export interface AuditEvent {
	id: number;
	createdAt: string;
	actorLabel: string;
	source: AuditSource;
	action: string;
	targetPk: number | null;
	targetEmail: string | null;
	details: Record<string, unknown> | null;
}

interface AuditEventRow {
	id: number;
	created_at: string;
	actor_label: string;
	source: string;
	action: string;
	target_pk: number | null;
	target_email: string | null;
	details: string | null;
}

// Best-effort, deliberately never throws: an action that already succeeded (the profile got
// updated, the invitation got sent) must never be reported as failed just because writing its
// audit trail afterwards hit a snag — same reasoning as mattermostBot.ts's notifications.
export function logAuditEvent(
	actor: AuditActor,
	source: AuditSource,
	action: string,
	target: { pk?: number; email?: string },
	details?: Record<string, unknown>
): void {
	try {
		ensureSchema();
		getDb()
			.prepare(
				`INSERT INTO audit_events (actor_sub, actor_label, source, action, target_pk, target_email, details)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				actor.sub,
				actor.label,
				source,
				action,
				target.pk ?? null,
				target.email ?? null,
				details ? JSON.stringify(details) : null
			);
	} catch (err) {
		console.error('Failed to write audit event', err);
	}
}

function parseDetails(details: string | null, eventId: number): Record<string, unknown> | null {
	if (!details) return null;
	try {
		return JSON.parse(details) as Record<string, unknown>;
	} catch (err) {
		// A single malformed row (manual DB edit, future incompatible format, ...) must never take
		// down the whole history page for every admin/member — same best-effort spirit as
		// logAuditEvent()'s own write-side try/catch above.
		console.error(`[auditLog] Failed to parse details JSON for event ${eventId}:`, err);
		return null;
	}
}

function rowToEvent(r: AuditEventRow): AuditEvent {
	return {
		id: r.id,
		createdAt: r.created_at,
		actorLabel: r.actor_label,
		source: r.source as AuditSource,
		action: r.action,
		targetPk: r.target_pk,
		targetEmail: r.target_email,
		details: parseDetails(r.details, r.id)
	};
}

export function listAuditEvents(limit = 200): AuditEvent[] {
	ensureSchema();
	const rows = getDb()
		.prepare(
			`SELECT id, created_at, actor_label, source, action, target_pk, target_email, details
			 FROM audit_events ORDER BY id DESC LIMIT ?`
		)
		.all(limit) as AuditEventRow[];

	return rows.map(rowToEvent);
}

// The member-facing "my history" view — both 'admin' events targeting this pk (an admin edited
// their profile via /admin) and 'user' events they generated themselves (target_pk is always set
// to their own pk for those, per logAuditEvent's convention).
export function listAuditEventsForTarget(pk: number, limit = 200): AuditEvent[] {
	ensureSchema();
	const rows = getDb()
		.prepare(
			`SELECT id, created_at, actor_label, source, action, target_pk, target_email, details
			 FROM audit_events WHERE target_pk = ? ORDER BY id DESC LIMIT ?`
		)
		.all(pk, limit) as AuditEventRow[];

	return rows.map(rowToEvent);
}
