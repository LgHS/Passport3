import type { Handle } from '@sveltejs/kit';
import { verifyIdToken } from '$lib/server/authentik';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(SESSION_COOKIE);

	if (sessionCookie) {
		try {
			event.locals.user = await verifyIdToken(sessionCookie);
		} catch {
			// Expired, tampered, or otherwise invalid session — drop it rather than looping on it.
			clearSessionCookie(event.cookies);
			event.locals.user = null;
		}
	} else {
		event.locals.user = null;
	}

	return resolve(event);
};
