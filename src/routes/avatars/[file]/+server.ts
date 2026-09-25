import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readAvatar } from '$lib/server/avatars';

// Members-only, like every page that shows an avatar. The file name itself is random and changes
// on every upload (see avatars.ts), which is what keeps a hidden member's photo out of reach and
// what makes the long cache below safe.
export const GET: RequestHandler = ({ params, locals }) => {
	if (!locals.user) {
		error(401, 'Connexion requise.');
	}

	const bytes = readAvatar(params.file);
	if (!bytes) {
		error(404, 'Image introuvable.');
	}

	return new Response(new Uint8Array(bytes), {
		headers: {
			'Content-Type': 'image/jpeg',
			'Cache-Control': 'private, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
			// Served as a bare image, never as a document that could run anything.
			'Content-Security-Policy': "default-src 'none'"
		}
	});
};
