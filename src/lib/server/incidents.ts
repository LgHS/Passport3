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
export async function listIncidents(): Promise<Incident[]> {
	const sql = await getDb();
	const rows = await sql<IncidentRow[]>`
		SELECT id, created_at, author_label, kind, occurred_at, people, visitor_involved, witnesses,
		       equipment, description, emergency_services_called, first_aid_used, first_aid_details,
		       fire_device_used, fire_device_details
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
		fireDeviceDetails: row.fire_device_details
	}));
}
