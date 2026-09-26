import postgres from 'postgres';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { runMigrations } from '$lib/server/migrations';

// Everything Passport persists on local disk (uploaded avatars — see avatars.ts) lives under this
// directory. Optional, with a default: unlike requireEnv()'d config, nothing about running
// Passport locally should require setting this up front. In Docker, DATA_DIR must point inside the
// persistent named volume declared in docker-compose*.yml, or uploaded photos are lost on every
// Watchtower redeploy.
export const DATA_DIR = env.DATA_DIR || 'data';

function createConnection(): postgres.Sql {
	return postgres({
		host: env.POSTGRES_HOST || 'localhost',
		port: Number(env.POSTGRES_PORT) || 5432,
		database: env.POSTGRES_DB,
		user: env.POSTGRES_USER,
		password: env.POSTGRES_PASSWORD,
		// Seconds. postgres.js waits 30 by default, which would leave a page hanging that long
		// when Postgres is unreachable instead of showing the "database unavailable" page.
		connect_timeout: 5,
		// Postgres reports COUNT/SUM/MAX as the bigint type (OID 20) so a value past
		// Number.MAX_SAFE_INTEGER is never silently rounded — postgres.js defaults to returning it as
		// a string for that reason. None of our aggregates get remotely close to that ceiling, and a
		// string here is an easy, silent bug (e.g. `count === 0` is false for the string "0") — parsed
		// back to a plain number globally instead, so this is never something a future query has to
		// remember to cast itself.
		types: {
			bigint: {
				to: 20,
				from: [20],
				serialize: (value: number) => String(value),
				parse: (raw: string) => Number(raw)
			}
		}
	});
}

async function init(): Promise<postgres.Sql> {
	const sql = createConnection();
	await runMigrations(sql);
	return sql;
}

declare global {
	// eslint-disable-next-line no-var -- ambient global augmentation requires `var`
	var __passportDbPromise: Promise<postgres.Sql> | undefined;
}

// Lazy singleton: one connection for the process lifetime, opened on first use rather than at
// module load, so importing this file never has a side effect on its own.
//
// Memoizes the *promise*, not the resolved connection: the assignment below runs synchronously up
// to that point, so two calls to getDb() arriving "at the same time" (e.g. the birthday
// scheduler's own startup check, started at hooks.server.ts's module scope, racing the very first
// HTTP request that also touches the DB) can never both see a blank slate and each kick off their
// own runMigrations() — the second call always finds the first call's promise already in place.
//
// In dev, Vite hot-reloads this module on every edit, which would otherwise reset the module-level
// variable below to `undefined` and orphan the previous connection (never closed, just
// unreferenced — accumulating enough of those across a long dev session can hit Postgres's
// max_connections). Stashed on `globalThis` instead, which survives a module reload; not needed in
// prod, where the process never reloads a module in place.
let dbPromise: Promise<postgres.Sql> | undefined = dev ? globalThis.__passportDbPromise : undefined;

export function getDb(): Promise<postgres.Sql> {
	if (!dbPromise) {
		dbPromise = init().catch((err) => {
			// Allows retrying on the next call rather than staying wedged after a startup-time outage.
			dbPromise = undefined;
			if (dev) globalThis.__passportDbPromise = undefined;
			throw err;
		});
		if (dev) globalThis.__passportDbPromise = dbPromise;
	}
	return dbPromise;
}

// Errors meaning "Postgres can't be reached right now" rather than a bug in a query: network-level
// failures (refused, unresolvable host, timeout, dropped connection — postgres.js's own codes plus
// Node's socket errors) and the server-side codes Postgres uses while starting up, shutting down or
// saturated. Used by hooks.server.ts's handleError to show one clear "database unavailable" page
// instead of a generic server error, whichever route hit the outage.
const UNAVAILABLE_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ENOTFOUND',
	'EAI_AGAIN',
	'ETIMEDOUT',
	'EHOSTUNREACH',
	'CONNECT_TIMEOUT',
	'CONNECTION_CLOSED',
	'CONNECTION_ENDED',
	'CONNECTION_DESTROYED',
	'57P01', // admin_shutdown
	'57P02', // crash_shutdown
	'57P03', // cannot_connect_now
	'53300' // too_many_connections
]);

export function isDatabaseUnavailable(err: unknown): boolean {
	const code = (err as { code?: unknown } | null)?.code;
	return typeof code === 'string' && UNAVAILABLE_CODES.has(code);
}

export const DATABASE_UNAVAILABLE_MESSAGE =
	'La base de données de Passport est temporairement indisponible. Réessayez dans quelques instants.';

// Footer status check (see health.ts). Never throws, and gives up after `timeoutMs` — including
// while the connection itself is still being attempted.
export async function checkDatabase(timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			getDb().then((sql) => sql`SELECT 1`),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
			})
		]);
		return true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

// `adapter-node` already registers its own SIGTERM/SIGINT handlers: it closes the HTTP server,
// lets in-flight requests finish, and only then emits this event — see
// node_modules/@sveltejs/adapter-node/files/index.js. A SIGTERM/SIGINT handler of our own here
// would run in parallel with that instead of after it, risking closing Postgres out from under a
// request that's still being handled. This event only fires under that adapter's production
// build; under `pnpm dev` it never fires, which is fine — nothing needs a clean shutdown there.
export async function closeDb(): Promise<void> {
	if (!dbPromise) return;
	const sql = await dbPromise.catch(() => null);
	await sql?.end({ timeout: 5 });
}

process.on('sveltekit:shutdown', () => {
	void closeDb();
});
