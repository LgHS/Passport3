import type { Handle, HandleServerError } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { checkEnv, formatEnvReport } from '$lib/server/envCheck';
import { OidcUnavailableError, verifyIdToken } from '$lib/server/authentik';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';
import { startBirthdayScheduler } from '$lib/server/birthdayScheduler';
import { startTaskReminderScheduler } from '$lib/server/taskReminders';
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailable } from '$lib/server/db';
import { requireAdmin } from '$lib/server/auth';

// Module scope, not inside `handle` below — runs exactly once per server process, unlike `handle`
// which runs on every request.
//
// The environment first: a missing POSTGRES_PASSWORD or AUTHENTIK_ISSUER used to show up as a 500
// on whichever page needed it first, so it is checked here and the process refuses to start. Build
// time is exempt — `vite build` evaluates this module with no environment at all, and so does CI.
if (!building) {
	// PUBLIC_* variables live in a separate namespace, hence the two objects merged into one view.
	const report = checkEnv({ ...env, ...publicEnv });
	for (const line of formatEnvReport(report)) {
		if (report.missing.length > 0 && line.startsWith('[env] variables obligatoires')) {
			console.error(line);
		} else {
			console.warn(line);
		}
	}
	if (report.missing.length > 0) {
		throw new Error(`Variables d'environnement manquantes : ${report.missing.join(', ')}`);
	}
}

startBirthdayScheduler();
startTaskReminderScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(SESSION_COOKIE);

	if (sessionCookie) {
		try {
			event.locals.user = await verifyIdToken(sessionCookie);
		} catch (err) {
			event.locals.user = null;
			if (err instanceof OidcUnavailableError) {
				// Authentik itself is unreachable, not a bad token — leave the cookie alone so the
				// member's real session resumes once Authentik is back, instead of logging everyone
				// out for the duration of an outage.
			} else {
				// Expired, tampered, or otherwise invalid session — drop it rather than looping on it.
				clearSessionCookie(event.cookies);
			}
		}
	} else {
		event.locals.user = null;
	}

	// Every /admin request — pages, form actions, endpoints, and the __data.json requests behind
	// client-side navigation — is checked here, before any of its code runs. admin/+layout.server.ts
	// alone isn't enough: SvelteKit only re-runs the loads a client says are invalidated, so a
	// request asking for the page's data alone skips the layout's check entirely.
	if (isAdminPath(event.url.pathname)) requireAdmin(event.locals);

	const response = await resolve(event);
	setSecurityHeaders(response.headers);
	return response;
};

export function isAdminPath(pathname: string): boolean {
	return pathname === '/admin' || pathname.startsWith('/admin/');
}

// One place for a Postgres outage, whichever page or action hit it: the pages that need the
// database (wishlist, audit log, birthday settings) show a clear "database unavailable" message
// rather than a generic server error. Everything else — profile, dues, badge, trombinoscope,
// avatars — doesn't touch the database, or only best-effort, and keeps working.
// SvelteKit doesn't let this hook change the status code (500), only the message, which is what
// +error.svelte shows.
export const handleError: HandleServerError = ({ error, message }) => {
	if (isDatabaseUnavailable(error)) {
		console.error('[db] unavailable:', (error as Error).message);
		return { message: DATABASE_UNAVAILABLE_MESSAGE };
	}
	console.error(error);
	return { message };
};

function setSecurityHeaders(headers: Headers) {
	headers.set('X-Content-Type-Options', 'nosniff');
	// frame-ancestors would be the modern equivalent, but it's ignored in a report-only CSP —
	// this one actually blocks clickjacking today.
	headers.set('X-Frame-Options', 'DENY');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
	if (!dev) {
		// No includeSubDomains/preload: other lghs.be subdomains aren't this app's call to make.
		headers.set('Strict-Transport-Security', 'max-age=31536000');
	}
}
