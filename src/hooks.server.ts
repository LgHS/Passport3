import type { Handle, HandleServerError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { OidcUnavailableError, verifyIdToken } from '$lib/server/authentik';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';
import { startBirthdayScheduler } from '$lib/server/birthdayScheduler';
import { startFactureScheduler } from '$lib/server/compta/factureScheduler';
import { startAdhesionSync } from '$lib/server/compta/adhesionSync';
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailable } from '$lib/server/db';

// Module scope, not inside `handle` below — runs exactly once per server process, unlike `handle`
// which runs on every request.
startBirthdayScheduler();
startFactureScheduler();
startAdhesionSync();

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

	const response = await resolve(event);
	setSecurityHeaders(response.headers);
	return response;
};

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
