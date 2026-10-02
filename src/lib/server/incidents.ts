import { getDb } from '$lib/server/db';
import type { IncidentKind } from '$lib/incidentDisplay';

// The incidents table is created by src/lib/server/migrations.ts (run once from db.ts's getDb())
// — see that file's migration 19.
//
// Reading declarations is admin-only: the route checks that before calling listIncidents(), so a
// non-admin's page never receives one at all rather than receiving them and hiding them client-side
// (same rule as the trombinoscope's server-side field filtering).

export interface IncidentAuthor {
	sub: string;
	label: string;
}

export interface IncidentInput {
	kind: IncidentKind;
	occurredAt: Date;
	people: string;
	visitorInvolved: boolean;
	witnesses: string | null;
	equipment: string | null;
	description: string;
	emergencyServicesCalled: boolean;
	firstAidUsed: boolean;
	firstAidDetails: string | null;
	fireDeviceUsed: boolean;
	fireDeviceDetails: string | null;
}

export interface Incident extends Omit<IncidentInput, 'occurredAt'> {
	id: number;
	createdAt: string;
	occurredAt: string;
	authorLabel: string;
	// Set once an admin removed it from the list. The row stays, see migration 28.
	deletedAt: string | null;
	deletedByLabel: string | null;
}

interface IncidentRow {
	id: number;
	created_at: Date;
	author_label: string;
	kind: string;
	occurred_at: Date;
	people: string;
	visitor_involved: boolean;
	witnesses: string | null;
	equipment: string | null;
	description: string;
	emergency_services_called: boolean;
	first_aid_used: boolean;
	first_aid_details: string | null;
	fire_device_used: boolean;
	fire_device_details: string | null;
	deleted_at: Date | null;
	deleted_by_label: string | null;
}

export async function createIncident(author: IncidentAuthor, input: IncidentInput): Promise<number> {
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO incidents (
			author_sub, author_label, kind, occurred_at, people, visitor_involved, witnesses, equipment,
			description, emergency_services_called, first_aid_used, first_aid_details, fire_device_used,
			fire_device_details
		)
		VALUES (
			${author.sub}, ${author.label}, ${input.kind}, ${input.occurredAt}, ${input.people},
			${input.visitorInvolved}, ${input.witnesses}, ${input.equipment}, ${input.description},
			${input.emergencyServicesCalled}, ${input.firstAidUsed}, ${input.firstAidDetails},
			${input.fireDeviceUsed}, ${input.fireDeviceDetails}
		)
		RETURNING id
	`;
	return row.id;
}

// author_sub is deliberately not selected: nothing displays it, and the label is already stored
// alongside it for that purpose.
//
// Removed declarations come back too, carrying `deletedAt`, so the page can offer to show them
// without a second round trip — the table gains a handful of rows a year, so there is nothing to
// save by filtering them out in SQL. They are hidden by default on the page, not here.
export async function listIncidents(): Promise<Incident[]> {
	const sql = await getDb();
	const rows = await sql<IncidentRow[]>`
		SELECT id, created_at, author_label, kind, occurred_at, people, visitor_involved, witnesses,
		       equipment, description, emergency_services_called, first_aid_used, first_aid_details,
		       fire_device_used, fire_device_details, deleted_at, deleted_by_label
		FROM incidents
		ORDER BY occurred_at DESC, id DESC
	`;

	return rows.map((row) => ({
		id: row.id,
		createdAt: row.created_at.toISOString(),
		authorLabel: row.author_label,
		kind: row.kind as IncidentKind,
		occurredAt: row.occurred_at.toISOString(),
		people: row.people,
		visitorInvolved: row.visitor_involved,
		witnesses: row.witnesses,
		equipment: row.equipment,
		description: row.description,
		emergencyServicesCalled: row.emergency_services_called,
		firstAidUsed: row.first_aid_used,
		firstAidDetails: row.first_aid_details,
		fireDeviceUsed: row.fire_device_used,
		fireDeviceDetails: row.fire_device_details,
		deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
		deletedByLabel: row.deleted_by_label
	}));
}

// Hides a declaration (an admin removing a mistaken or duplicate one). Nothing is destroyed: the
// row and its photos stay, see migration 28. Returns what the audit entry needs, or null when
// there is no such declaration **or it was already removed** — so removing one twice is reported
// as not found rather than silently rewriting who removed it and when.
export async function softDeleteIncident(
	id: number,
	by: IncidentAuthor
): Promise<{ authorSub: string; kind: IncidentKind } | null> {
	const sql = await getDb();
	const [row] = await sql<{ author_sub: string; kind: string }[]>`
		UPDATE incidents
		SET deleted_at = now(), deleted_by_sub = ${by.sub}, deleted_by_label = ${by.label}
		WHERE id = ${id} AND deleted_at IS NULL
		RETURNING author_sub, kind
	`;
	return row ? { authorSub: row.author_sub, kind: row.kind as IncidentKind } : null;
}

// Puts a removed declaration back in the list, for a removal made by mistake. The symmetric
// `deleted_at IS NOT NULL` means restoring one that was never removed reports not found instead of
// clearing columns that were already empty. Who removed it is cleared along with the date: the
// declaration is in the list again, so there is nothing left to explain. The audit log keeps both
// the removal and the restoration either way.
export async function restoreIncident(
	id: number
): Promise<{ authorSub: string; kind: IncidentKind } | null> {
	const sql = await getDb();
	const [row] = await sql<{ author_sub: string; kind: string }[]>`
		UPDATE incidents
		SET deleted_at = NULL, deleted_by_sub = NULL, deleted_by_label = NULL
		WHERE id = ${id} AND deleted_at IS NOT NULL
		RETURNING author_sub, kind
	`;
	return row ? { authorSub: row.author_sub, kind: row.kind as IncidentKind } : null;
}
