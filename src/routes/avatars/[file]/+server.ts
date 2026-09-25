import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGeneratedAvatar, isAvatarFileName, readAvatar } from '$lib/server/avatars';
import { getInitialsForEmailHash } from '$lib/server/authentikAdmin';
import { DEFAULT_AVATAR_PNG } from '$lib/server/defaultAvatar';

// Passport's own avatar service, keyed like Gravatar (md5 of the lowercased email) so Authentik and
// BookStack can use it as their avatar source — which is also why it's public: anyone who knows a
// member's email can fetch their avatar. Always answers with an image, and never calls a third
// party:
// 1. the member's uploaded photo;
// 2. otherwise an image of their initials (first two characters of their username), generated on
//    first request and then cached on disk;
// 3. for a hash that matches no member (or if Authentik can't be reached to find out), a neutral
//    silhouette.
// A single size is served (512px); callers scale it down. `s`/`size` query parameters are ignored.

const headers = {
	'X-Content-Type-Options': 'nosniff',
	// Embeddable from other origins (Authentik, BookStack), but only ever as a bare image.
	'Cross-Origin-Resource-Policy': 'cross-origin',
	'Content-Security-Policy': "default-src 'none'"
};

export const GET: RequestHandler = async ({ params }) => {
	if (!isAvatarFileName(params.file)) {
		error(404, 'Image introuvable.');
	}

	const avatar = readAvatar(params.file);
	if (avatar) {
		return new Response(new Uint8Array(avatar.bytes), {
			headers: {
				...headers,
				'Content-Type': 'image/jpeg',
				// The file name stays the same across uploads (it's the email hash), so caches must
				// expire; Passport's own pages add a `?v=` cache-buster that changes on every upload.
				'Cache-Control': 'public, max-age=3600',
				'Last-Modified': avatar.modifiedAt.toUTCString()
			}
		});
	}

	const hash = params.file.replace(/\.jpg$/, '');
	const initials = await getInitialsForEmailHash(hash).catch(() => null);
	if (initials) {
		return new Response(new Uint8Array(getGeneratedAvatar(hash, initials)), {
			headers: { ...headers, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }
		});
	}

	// Short cache: an unknown hash may just be a member Authentik couldn't be asked about right now.
	return new Response(new Uint8Array(DEFAULT_AVATAR_PNG), {
		headers: { ...headers, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' }
	});
};
