import { beforeEach, describe, expect, it, vi } from 'vitest';

// What the audit log must never hold, whichever action writes to it: third parties' contact
// details, a live physical-access credential, or what a declaration says. The audit log is read by
// every admin, and by the member on their own /profile.
const CONTACT = { name: 'Jeanne Secret', phone: '32471234567', relation: 'Mère' };
const RFID_UUID = '6f1c2a4e-9b7d-4c3a-8e21-0d5f7a9b1c34';
const INCIDENT_SECRETS = ['Entaille profonde', 'Bob Blessé', 'compresses stériles', 'Carol Témoin', 'découpeuse laser'];

const audit = vi.fn(async (..._args: unknown[]) => {});
vi.mock('$lib/server/auditLog', () => ({ logAuditEvent: audit, listAuditEventsForTarget: async () => [] }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTHENTIK_ADMIN_GROUP: 'Passport Admin' } }));

// Authentik: the calls these actions make, returning what a real one would — the UUID in clear.
vi.mock('$lib/server/authentikAdmin', async (importOriginal) => ({
	...(await importOriginal<object>()),
	updateEmergencyContacts: async (_pk: number, contacts: unknown[]) => ({ before: [CONTACT], after: contacts }),
	getRfidUid: async () => RFID_UUID,
	regenerateRfidUid: async () => RFID_UUID
}));
vi.mock('$lib/server/incidents', () => ({ createIncident: async () => 4 }));
vi.mock('$lib/server/incidentPhotos', () => ({
	validateIncidentPhotos: async () => ({ ok: true, photos: [] }),
	saveIncidentPhotos: () => {}
}));

const member = { sub: '12', name: 'Ana Membre', preferred_username: 'ana', groups: ['Membres'] };
const admin = { sub: '1', name: 'Admin', preferred_username: 'admin', groups: ['Passport Admin'] };

function form(fields: [string, string][]): Request {
	const data = new FormData();
	for (const [k, v] of fields) data.append(k, v);
	return new Request('http://localhost/', { method: 'POST', body: data });
}

// Everything the action handed to the audit log, as one string.
const logged = () => JSON.stringify(audit.mock.calls);

type Action = (event: unknown) => Promise<unknown>;
const run = (action: unknown, event: Record<string, unknown>) => (action as Action)(event);

beforeEach(() => audit.mockClear());

describe("journal d'audit : contacts d'urgence", () => {
	const contactsForm = () =>
		form([
			['name[]', CONTACT.name],
			['phone[]', CONTACT.phone],
			['relation[]', CONTACT.relation]
		]);

	it("le membre qui modifie les siens : seulement le nombre de contacts", async () => {
		const { actions } = await import('../src/routes/profile/+page.server');
		await run(actions.updateEmergencyContacts, { request: contactsForm(), locals: { user: member } });
		expect(audit).toHaveBeenCalledOnce();
		for (const secret of Object.values(CONTACT)) expect(logged()).not.toContain(secret);
		expect(logged()).toContain('contactCount');
	});

	it("un admin qui modifie ceux d'un membre : seulement le nombre de contacts", async () => {
		const { actions } = await import('../src/routes/admin/users/[pk]/+page.server');
		await run(actions.updateEmergencyContacts, {
			request: contactsForm(),
			params: { pk: '12' },
			locals: { user: admin }
		});
		expect(audit).toHaveBeenCalledOnce();
		for (const secret of Object.values(CONTACT)) expect(logged()).not.toContain(secret);
	});
});

describe("journal d'audit : badge RFID", () => {
	it('le membre qui régénère son badge : jamais l’UUID', async () => {
		const { actions } = await import('../src/routes/badge/+page.server');
		await run(actions.regenerate, { request: form([['confirmRegenerate', 'yes']]), locals: { user: member } });
		expect(audit).toHaveBeenCalledOnce();
		expect(logged()).not.toContain(RFID_UUID);
	});

	it("un admin qui régénère celui d'un membre : jamais l’UUID", async () => {
		const { actions } = await import('../src/routes/admin/users/[pk]/+page.server');
		await run(actions.regenerateRfid, {
			request: form([['confirmRegenerate', 'yes']]),
			params: { pk: '12' },
			locals: { user: admin }
		});
		expect(audit).toHaveBeenCalledOnce();
		expect(logged()).not.toContain(RFID_UUID);
	});
});

describe("journal d'audit : déclaration d'incident", () => {
	it('seulement le numéro, le type et le nombre de photos', async () => {
		const { actions } = await import('../src/routes/incidents/+page.server');
		await run(actions.create, {
			request: form([
				['kind', 'accident'],
				['occurredAt', '2026-09-01T10:00'],
				['people', 'Bob Blessé'],
				['witnesses', 'Carol Témoin'],
				['equipment', 'découpeuse laser'],
				['description', 'Entaille profonde à la main gauche'],
				['firstAidUsed', 'on'],
				['firstAidDetails', 'compresses stériles'],
				['certified', 'on']
			]),
			locals: { user: member }
		});
		expect(audit).toHaveBeenCalledOnce();
		const details = audit.mock.calls[0][4];
		expect(details).toEqual({ incidentId: 4, kind: 'accident', photos: 0 });
		for (const secret of INCIDENT_SECRETS) expect(logged()).not.toContain(secret);
	});
});
