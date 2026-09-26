import type { Handle, HandleServerError } from '@sveltejs/kit';
import { OidcUnavailableError, verifyIdToken } from '$lib/server/authentik';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';
import { startBirthdayScheduler } from '$lib/server/birthdayScheduler';
import { DATABASE_UNAVAILABLE_MESSAGE, isDatabaseUnavailable } from '$lib/server/db';

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

	return resolve(event);
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
