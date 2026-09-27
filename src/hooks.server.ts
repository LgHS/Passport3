import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { OidcUnavailableError, verifyIdToken } from '$lib/server/authentik';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';
import { startBirthdayScheduler } from '$lib/server/birthdayScheduler';

// Module scope, not inside `handle` below — runs exactly once per server process, unlike `handle`
// which runs on every request.
startBirthdayScheduler();

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
