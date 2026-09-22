import { getDb } from '$lib/server/db';

// Any new action that mutates a member's account or admin-side data should call logAuditEvent()
// below, the same way every existing admin/*+page.server.ts and member self-service action does —
// see the README's "Audit log" section. This is also the single place a future Mattermost push
// for these events should hook in, rather than each of the ~15 call sites individually.
//
// The audit_events table itself is created by src/lib/server/migrations.ts (run once from
// db.ts's getDb()) rather than by this module — see that file's migrations 1 and 2.

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
	const rows = getDb()
		.prepare(
			`SELECT id, created_at, actor_label, source, action, target_pk, target_email, details
			 FROM audit_events WHERE target_pk = ? ORDER BY id DESC LIMIT ?`
		)
		.all(pk, limit) as AuditEventRow[];

	return rows.map(rowToEvent);
}
