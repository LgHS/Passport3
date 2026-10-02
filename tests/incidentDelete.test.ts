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

// Stands in for the UPDATE: declaration 4 exists and is not yet removed, everything else (an
// unknown id, or one already removed) comes back null — that is how the query reports both.
const softDeleteIncident = vi.fn(async (id: number, _by: { sub: string; label: string }) =>
	id === 4 ? { authorSub: '12', kind: 'accident' } : null
);
// Declaration 5 is the removed one, so restoring it works and restoring anything else (unknown, or
// already in the list) comes back null — the `deleted_at IS NOT NULL` clause reports both that way.
const restoreIncident = vi.fn(async (id: number) =>
	id === 5 ? { authorSub: '12', kind: 'incident' } : null
);
vi.mock('$lib/server/incidents', () => ({
	softDeleteIncident,
	restoreIncident,
	listIncidents: async () => []
}));

const photos = await import('$lib/server/incidentPhotos');
const { actions } = await import('../src/routes/admin/incidents/+page.server');

const admin = { sub: '1', name: 'Admin', groups: ['Passport Admin'] };
const member = { sub: '12', name: 'Membre', groups: ['Membres'] };

function run(action: 'delete' | 'restore', incidentId: string, user: unknown) {
	const data = new FormData();
	data.append('incidentId', incidentId);
	const request = new Request('http://localhost/', { method: 'POST', body: data });
	return (actions[action] as (event: unknown) => Promise<unknown>)({ request, locals: { user } });
}

const deleteRequest = (incidentId: string, user: unknown) => run('delete', incidentId, user);
const restoreRequest = (incidentId: string, user: unknown) => run('restore', incidentId, user);

beforeEach(() => {
	audit.mockClear();
	softDeleteIncident.mockClear();
	restoreIncident.mockClear();
});

describe('retrait d’une déclaration par un admin', () => {
	it('retire la déclaration et journalise le numéro et le type, rien d’autre', async () => {
		expect(await deleteRequest('4', admin)).toEqual({ deleted: true });
		expect(audit).toHaveBeenCalledOnce();
		const [, source, action, target, details] = audit.mock.calls[0];
		expect([source, action, target, details]).toEqual([
			'admin',
			'incident.delete',
			{ pk: 12 },
			{ incidentId: 4, kind: 'accident' }
		]);
	});

	it('enregistre qui l’a retirée', async () => {
		await deleteRequest('4', admin);
		expect(softDeleteIncident).toHaveBeenCalledWith(4, { sub: '1', label: 'Admin' });
	});

	// Le point de tout ce changement : une déclaration est exigée par la législation et l'assurance,
	// donc la retirer de la liste ne doit rien détruire.
	it('garde les photos de la déclaration retirée', async () => {
		photos.saveIncidentPhotos(4, [new Uint8Array([1]), new Uint8Array([2])]);
		await deleteRequest('4', admin);
		expect(photos.listIncidentPhotos(4)).toEqual([1, 2]);
	});

	it('répond 404 pour une déclaration inexistante, sans rien journaliser', async () => {
		expect(await deleteRequest('7', admin)).toMatchObject({ status: 404 });
		expect(audit).not.toHaveBeenCalled();
	});

	it('répond 404 pour une déclaration déjà retirée, sans journaliser deux fois', async () => {
		// Le mock ne rend la déclaration qu'une fois ; une seconde soumission ne doit pas réécrire
		// qui l'a retirée ni ajouter une entrée d'audit.
		softDeleteIncident.mockResolvedValueOnce({ authorSub: '12', kind: 'accident' });
		softDeleteIncident.mockResolvedValueOnce(null);
		expect(await deleteRequest('4', admin)).toEqual({ deleted: true });
		expect(await deleteRequest('4', admin)).toMatchObject({ status: 404 });
		expect(audit).toHaveBeenCalledOnce();
	});

	it('refuse un identifiant invalide sans toucher à la base', async () => {
		expect(await deleteRequest('abc', admin)).toMatchObject({ status: 400 });
		expect(softDeleteIncident).not.toHaveBeenCalled();
	});

	it('refuse un identifiant négatif ou nul', async () => {
		expect(await deleteRequest('0', admin)).toMatchObject({ status: 400 });
		expect(await deleteRequest('-3', admin)).toMatchObject({ status: 400 });
		expect(softDeleteIncident).not.toHaveBeenCalled();
	});

	it('refuse un membre qui n’est pas admin, sans rien retirer ni supprimer', async () => {
		photos.saveIncidentPhotos(4, [new Uint8Array([1])]);
		// Comparé à l'état d'avant plutôt qu'à une liste figée : le dossier temporaire est partagé
		// par tous les tests du fichier, donc la déclaration 4 peut déjà porter d'autres photos.
		const before = photos.listIncidentPhotos(4);
		expect(before.length).toBeGreaterThan(0);
		await expect(deleteRequest('4', member)).rejects.toMatchObject({ status: 403 });
		expect(softDeleteIncident).not.toHaveBeenCalled();
		expect(photos.listIncidentPhotos(4)).toEqual(before);
	});
});

describe('remise dans la liste par un admin', () => {
	it('restaure la déclaration et journalise le numéro et le type, rien d’autre', async () => {
		expect(await restoreRequest('5', admin)).toEqual({ restored: true });
		expect(restoreIncident).toHaveBeenCalledWith(5);
		expect(audit).toHaveBeenCalledOnce();
		const [, source, action, target, details] = audit.mock.calls[0];
		expect([source, action, target, details]).toEqual([
			'admin',
			'incident.restore',
			{ pk: 12 },
			{ incidentId: 5, kind: 'incident' }
		]);
	});

	it('répond 404 pour une déclaration déjà dans la liste, sans rien journaliser', async () => {
		// Le mock ne restaure que la 5 : la 4 n'a jamais été retirée, donc il n'y a rien à remettre.
		expect(await restoreRequest('4', admin)).toMatchObject({ status: 404 });
		expect(audit).not.toHaveBeenCalled();
	});

	it('refuse un identifiant invalide sans toucher à la base', async () => {
		expect(await restoreRequest('abc', admin)).toMatchObject({ status: 400 });
		expect(await restoreRequest('0', admin)).toMatchObject({ status: 400 });
		expect(restoreIncident).not.toHaveBeenCalled();
	});

	it('refuse un membre qui n’est pas admin', async () => {
		await expect(restoreRequest('5', member)).rejects.toMatchObject({ status: 403 });
		expect(restoreIncident).not.toHaveBeenCalled();
	});
});
