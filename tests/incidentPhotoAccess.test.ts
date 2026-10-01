import { describe, expect, it, vi } from 'vitest';

// The admin group the route checks against, and a photo that exists for incident 4.
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTHENTIK_ADMIN_GROUP: 'Passport Admin' } }));
vi.mock('$lib/server/incidentPhotos', () => ({
	readIncidentPhoto: (id: number, n: number) => (id === 4 && n === 1 ? Buffer.from([0xff, 0xd8]) : null)
}));

const { GET } = await import('../src/routes/admin/incidents/[id]/photos/[n]/+server');

type Locals = App.Locals;
const call = (locals: Partial<Locals>, id = '4', n = '1') =>
	// Only params and locals are read by this handler.
	(GET as unknown as (event: unknown) => Response)({ params: { id, n }, locals });

const member = { sub: '12', name: 'Membre', groups: ['Membres'] };
const admin = { sub: '1', name: 'Admin', groups: ['Passport Admin'] };

function thrown(fn: () => unknown): { status?: number; location?: string } {
	try {
		fn();
	} catch (err) {
		return err as { status?: number; location?: string };
	}
	throw new Error('expected the handler to throw');
}

describe("photo d'incident : accès", () => {
	it('redirige un visiteur non connecté vers la connexion', () => {
		const err = thrown(() => call({ user: null } as Partial<Locals>));
		expect(err.status).toBe(302);
		expect(err.location).toBe('/login');
	});

	it('refuse un membre qui n’est pas admin (403)', () => {
		expect(thrown(() => call({ user: member } as unknown as Partial<Locals>)).status).toBe(403);
	});

	it('sert la photo à un admin, sans cache', () => {
		const res = call({ user: admin } as unknown as Partial<Locals>);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/jpeg');
		expect(res.headers.get('Cache-Control')).toBe('private, no-store');
	});

	it('répond 404 à un admin pour une photo qui n’existe pas ou une adresse invalide', () => {
		expect(thrown(() => call({ user: admin } as unknown as Partial<Locals>, '4', '9')).status).toBe(404);
		expect(thrown(() => call({ user: admin } as unknown as Partial<Locals>, '../x', '1')).status).toBe(404);
	});
});
