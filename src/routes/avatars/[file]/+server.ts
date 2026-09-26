import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { generatedFileName, getGeneratedAvatar, isAvatarFileName, statAvatar } from '$lib/server/avatars';
import { getAvatarInfoForEmailHash } from '$lib/server/authentikAdmin';
import { DEFAULT_AVATAR_PNG } from '$lib/server/defaultAvatar';

// Passport's own avatar service, keyed like Gravatar (md5 of the lowercased email) so Authentik and
// BookStack can use it as their avatar source — which is also why it's public: anyone who knows a
// member's email can fetch their avatar. Always answers with an image, never calls a third party,
// and never touches the database:
// 1. the member's uploaded photo;
// 2. otherwise an image of their initials (first two characters of their username), in the colour
//    they picked, generated on first request and then cached on disk;
// 3. for a hash that matches no member (or if Authentik can't be reached to find out), a neutral
//    silhouette.
// A single size is served (512px); callers scale it down. `s`/`size` query parameters are ignored.
//
// The URL stays the same when the image changes (new photo, new colour, photo deleted), so every
// response has an ETag and `no-cache`: browsers, Authentik and BookStack revalidate on each use and
// get a bodiless 304 while nothing changed — decided from file metadata alone, without reading or
// rendering the image — and the new image as soon as it did.

const headers = {
	'X-Content-Type-Options': 'nosniff',
	// Embeddable from other origins (Authentik, BookStack), but only ever as a bare image.
	'Cross-Origin-Resource-Policy': 'cross-origin',
	'Content-Security-Policy': "default-src 'none'"
};

function respond(
	request: Request,
	etag: string,
	cacheControl: string,
	contentType: string,
	body: () => Buffer,
	extra: Record<string, string> = {}
): Response {
	const cacheHeaders = { ...headers, ...extra, ETag: etag, 'Cache-Control': cacheControl };
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: cacheHeaders });
	}
	return new Response(new Uint8Array(body()), { headers: { ...cacheHeaders, 'Content-Type': contentType } });
}

export const GET: RequestHandler = async ({ params, request }) => {
	if (!isAvatarFileName(params.file)) {
		error(404, 'Image introuvable.');
	}

	const photo = statAvatar(params.file);
	if (photo) {
		return respond(
			request,
			`"p-${photo.size}-${photo.modifiedAt.getTime()}"`,
			'public, no-cache',
			'image/jpeg',
			() => readFileSync(photo.path),
			{ 'Last-Modified': photo.modifiedAt.toUTCString() }
		);
	}

	const hash = params.file.replace(/\.jpg$/, '');
	const info = await getAvatarInfoForEmailHash(hash).catch(() => null);
	if (info) {
		return respond(
			request,
			`"g-${generatedFileName(hash, info.initials, info.variant)}"`,
			'public, no-cache',
			'image/png',
			() => getGeneratedAvatar(hash, info.initials, info.variant)
		);
	}

	// Short cache: an unknown hash may just be a member Authentik couldn't be asked about right now.
	return respond(request, '"s"', 'public, max-age=300', 'image/png', () => DEFAULT_AVATAR_PNG);
};
