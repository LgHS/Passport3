import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Photos go to a throwaway data folder; the database and the audit log are replaced.
const dataDir = mkdtempSync(join(tmpdir(), 'passport-incidents-'));
vi.mock('$env/dynamic/private', () => ({ env: { DATA_DIR: dataDir } }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTHENTIK_ADMIN_GROUP: 'Passport Admin' } }));

const audit = vi.fn(async (..._args: unknown[]) => {});
vi.mock('$lib/server/auditLog', () => ({ logAuditEvent: audit }));
const deleteIncident = vi.fn(async (id: number) => (id === 4 ? { authorSub: '12', kind: 'accident' } : null));
vi.mock('$lib/server/incidents', () => ({ deleteIncident, listIncidents: async () => [] }));

const photos = await import('$lib/server/incidentPhotos');
const { actions } = await import('../src/routes/admin/incidents/+page.server');

const admin = { sub: '1', name: 'Admin', groups: ['Passport Admin'] };
const member = { sub: '12', name: 'Membre', groups: ['Membres'] };

function deleteRequest(incidentId: string, user: unknown) {
	const data = new FormData();
	data.append('incidentId', incidentId);
	const request = new Request('http://localhost/', { method: 'POST', body: data });
	return (actions.delete as (event: unknown) => Promise<unknown>)({ request, locals: { user } });
}

beforeEach(() => {
	audit.mockClear();
	deleteIncident.mockClear();
});

describe('photos d’une déclaration supprimée', () => {
	it('supprime toutes ses photos, et seulement les siennes', () => {
		photos.saveIncidentPhotos(4, [new Uint8Array([1]), new Uint8Array([2])]);
		photos.saveIncidentPhotos(5, [new Uint8Array([3])]);
		photos.deleteIncidentPhotos(4);
		expect(photos.listIncidentPhotos(4)).toEqual([]);
		expect(photos.listIncidentPhotos(5)).toEqual([1]);
	});

	it('ne plante pas pour une déclaration sans photo', () => {
		expect(() => photos.deleteIncidentPhotos(99)).not.toThrow();
	});
});

describe('suppression d’une déclaration par un admin', () => {
	it('supprime la déclaration et ses photos, et l’audit ne garde que le numéro et le type', async () => {
		photos.saveIncidentPhotos(4, [new Uint8Array([1])]);
		expect(await deleteRequest('4', admin)).toEqual({ deleted: true });
		expect(deleteIncident).toHaveBeenCalledWith(4);
		expect(photos.listIncidentPhotos(4)).toEqual([]);
		expect(audit).toHaveBeenCalledOnce();
		const [, source, action, target, details] = audit.mock.calls[0];
		expect([source, action, target, details]).toEqual([
			'admin',
			'incident.delete',
			{ pk: 12 },
			{ incidentId: 4, kind: 'accident' }
		]);
	});

	it('répond 404 pour une déclaration inexistante, sans rien journaliser', async () => {
		expect(await deleteRequest('7', admin)).toMatchObject({ status: 404 });
		expect(audit).not.toHaveBeenCalled();
	});

	it('refuse un identifiant invalide sans toucher à la base', async () => {
		expect(await deleteRequest('abc', admin)).toMatchObject({ status: 400 });
		expect(deleteIncident).not.toHaveBeenCalled();
	});

	it('refuse un membre qui n’est pas admin, sans rien supprimer', async () => {
		photos.saveIncidentPhotos(4, [new Uint8Array([1])]);
		await expect(deleteRequest('4', member)).rejects.toMatchObject({ status: 403 });
		expect(deleteIncident).not.toHaveBeenCalled();
		expect(photos.listIncidentPhotos(4)).toEqual([1]);
	});
});
