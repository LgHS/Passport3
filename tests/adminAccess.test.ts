import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The hook starts the schedulers on import and verifies sessions against Authentik: both are
// replaced, the session by whoever the cookie names.
vi.mock('$lib/server/birthdayScheduler', () => ({ startBirthdayScheduler: () => {} }));
vi.mock('$lib/server/taskReminders', () => ({ startTaskReminderScheduler: () => {} }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTHENTIK_ADMIN_GROUP: 'Passport Admin' } }));
vi.mock('$lib/server/authentik', () => ({
	OidcUnavailableError: class extends Error {},
	verifyIdToken: async (token: string) =>
		token === 'admin'
			? { sub: '1', name: 'Admin', groups: ['Passport Admin'] }
			: { sub: '12', name: 'Membre', groups: ['Membres'] }
}));

const { handle, isAdminPath } = await import('../src/hooks.server');

function request(path: string, session?: 'admin' | 'member') {
	const resolve = vi.fn(async () => new Response('ok'));
	const event = {
		url: new URL(`http://localhost${path}`),
		cookies: { get: () => session, delete: () => {}, set: () => {} },
		locals: {} as App.Locals
	};
	return { resolve, run: () => handle({ event, resolve } as never) };
}

async function outcome(path: string, session?: 'admin' | 'member') {
	const { resolve, run } = request(path, session);
	try {
		await run();
		return resolve.mock.calls.length ? 'served' : 'not served';
	} catch (err) {
		const e = err as { status?: number; location?: string };
		return e.location ? `redirect ${e.location}` : `error ${e.status}`;
	}
}

describe('isAdminPath', () => {
	it('couvre /admin et tout ce qui est dessous, données de navigation comprises', () => {
		for (const path of ['/admin', '/admin/', '/admin/users/12', '/admin/users/12/__data.json', '/admin/incidents/4/photos/1']) {
			expect(isAdminPath(path), path).toBe(true);
		}
	});
	it('ne déborde pas sur les autres pages', () => {
		for (const path of ['/', '/administration', '/profile', '/admins', '/trombinoscope']) {
			expect(isAdminPath(path), path).toBe(false);
		}
	});
});

describe('hook serveur : accès à /admin', () => {
	// The __data.json request asking for the page's data alone is the one that used to skip the
	// admin layout's check — it must be stopped here like any other.
	const paths = ['/admin', '/admin/users/12', '/admin/users/12/__data.json?x-sveltekit-invalidated=001'];

	it('redirige un visiteur non connecté vers la connexion, sans rien servir', async () => {
		for (const path of paths) expect(await outcome(path), path).toBe('redirect /login');
	});

	it('refuse un membre qui n’est pas admin (403)', async () => {
		for (const path of paths) expect(await outcome(path, 'member'), path).toBe('error 403');
	});

	it('laisse passer un admin', async () => {
		for (const path of paths) expect(await outcome(path, 'admin'), path).toBe('served');
	});

	it('ne touche pas aux pages membres', async () => {
		expect(await outcome('/profile', 'member')).toBe('served');
	});
});

// A second line of defence that doesn't rely on the hook: every load, form action and endpoint
// under src/routes/admin checks for an admin itself.
function serverFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return serverFiles(path);
		return /^\+(page|layout)\.server\.ts$|^\+server\.ts$/.test(name) ? [path] : [];
	});
}

// Each `export const load|GET|POST…` and each action (`name: async (`) up to the next one.
function handlerBodies(source: string): { name: string; body: string }[] {
	const starts = [...source.matchAll(/^export const (load|GET|POST|PUT|PATCH|DELETE)\b|^\t(\w+): async \(/gm)];
	return starts.map((m, i) => ({
		name: m[1] ?? m[2],
		body: source.slice(m.index, starts[i + 1]?.index ?? source.length)
	}));
}

describe('chaque point d’entrée admin vérifie lui-même l’admin', () => {
	const files = serverFiles('src/routes/admin');

	it('trouve bien les fichiers à vérifier', () => {
		expect(files.length).toBeGreaterThan(5);
	});

	for (const file of files) {
		for (const { name, body } of handlerBodies(readFileSync(file, 'utf8'))) {
			it(`${file} — ${name}`, () => {
				expect(body).toMatch(/requireAdmin(User)?\(locals\)/);
			});
		}
	}
});
