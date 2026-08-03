import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEndSessionUrl } from '$lib/server/authentik';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';

export const POST: RequestHandler = async ({ cookies, url }) => {
	const idToken = cookies.get(SESSION_COOKIE);
	clearSessionCookie(cookies);

	if (idToken) {
		const endSessionUrl = await getEndSessionUrl(idToken, url.origin).catch(() => null);
		if (endSessionUrl) {
			redirect(302, endSessionUrl);
		}
	}

	redirect(302, '/');
};
