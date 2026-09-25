import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAvatarFileName, readAvatar } from '$lib/server/avatars';
import { DEFAULT_AVATAR_PNG } from '$lib/server/defaultAvatar';

// Public on purpose: Authentik and BookStack load these URLs directly, from a browser or a server
// that isn't logged into Passport, keyed by the md5 hash of the member's email — the same scheme
// as Gravatar (see avatars.ts). Anyone who knows a member's email can therefore fetch their photo.
//
// Always answers with an image: the member's uploaded photo if there is one, otherwise their
// Gravatar, fetched and served by Passport itself (so those services only ever deal with this one
// URL, and the member's browser never talks to Gravatar). `d` picks Gravatar's fallback when the
// member has no Gravatar either — `mp` (a neutral silhouette) by default; `d=404` is still
// available for a caller that wants to fall through to its own fallback (e.g. Authentik initials).
// If Gravatar itself fails, Passport's own silhouette is returned instead (see defaultAvatar.ts).

const GRAVATAR_TIMEOUT_MS = 5_000;
const GRAVATAR_CACHE_TTL_MS = 60 * 60 * 1000;
const GRAVATAR_CACHE_MAX_ENTRIES = 500;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
// Some CDNs treat requests with Node's default User-Agent as bots; identify ourselves plainly.
const GRAVATAR_USER_AGENT = 'Passport3 avatar proxy (+https://github.com/LgHS/Passport3)';

type CachedImage = { bytes: Uint8Array; type: string; expiresAt: number };
// Keeps a page full of avatars (e.g. a BookStack listing) from turning into one Gravatar request
// per image per view. Plain insertion-ordered Map: the oldest entry is evicted when full.
const gravatarCache = new Map<string, CachedImage>();

const baseHeaders = {
	'X-Content-Type-Options': 'nosniff',
	// Embeddable from other origins (Authentik, BookStack), but only ever as a bare image.
	'Cross-Origin-Resource-Policy': 'cross-origin',
	'Content-Security-Policy': "default-src 'none'"
};

// Null when Gravatar has no image to give: a real 404 (only expected with d=404), an unreachable
// Gravatar, or an unexpected answer. Everything but the expected 404 is logged, so a failing
// fallback can be diagnosed from the server logs instead of guessed at.
async function fetchGravatar(hash: string, size: string, fallback: string): Promise<CachedImage | null> {
	const key = `${hash}|${size}|${fallback}`;
	const cached = gravatarCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached;
	gravatarCache.delete(key);

	const url = new URL(`https://www.gravatar.com/avatar/${hash}`);
	url.searchParams.set('s', size);
	url.searchParams.set('d', fallback);

	let res: Response;
	try {
		res = await fetch(url, {
			headers: { 'User-Agent': GRAVATAR_USER_AGENT, Accept: 'image/*' },
			signal: AbortSignal.timeout(GRAVATAR_TIMEOUT_MS)
		});
	} catch (err) {
		console.warn(`[avatars] Gravatar unreachable for ${url}: ${err instanceof Error ? err.message : err}`);
		return null;
	}
	const type = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
	if (!res.ok || !IMAGE_TYPES.has(type)) {
		if (!(res.status === 404 && fallback === '404')) {
			console.warn(`[avatars] Unexpected Gravatar answer for ${url}: ${res.status} ${type} (final URL ${res.url})`);
		}
		return null;
	}

	const image = { bytes: new Uint8Array(await res.arrayBuffer()), type, expiresAt: Date.now() + GRAVATAR_CACHE_TTL_MS };
	if (gravatarCache.size >= GRAVATAR_CACHE_MAX_ENTRIES) {
		gravatarCache.delete(gravatarCache.keys().next().value!);
	}
	gravatarCache.set(key, image);
	return image;
}

export const GET: RequestHandler = async ({ params, url }) => {
	if (!isAvatarFileName(params.file)) {
		error(404, 'Image introuvable.');
	}

	const avatar = readAvatar(params.file);
	if (avatar) {
		return new Response(new Uint8Array(avatar.bytes), {
			headers: {
				...baseHeaders,
				'Content-Type': 'image/jpeg',
				// The file name stays the same across uploads (it's the email hash), so caches must
				// expire; Passport's own pages add a `?v=` cache-buster that changes on every upload.
				'Cache-Control': 'public, max-age=3600',
				'Last-Modified': avatar.modifiedAt.toUTCString()
			}
		});
	}

	const requestedSize = url.searchParams.get('s') ?? url.searchParams.get('size') ?? '';
	const size = /^\d{1,4}$/.test(requestedSize) ? String(Math.min(2048, Math.max(1, Number(requestedSize)))) : '512';
	const requestedFallback = url.searchParams.get('d') ?? '';
	const fallback = /^[a-z0-9-]{1,20}$/.test(requestedFallback) ? requestedFallback : 'mp';

	const gravatar = await fetchGravatar(params.file.replace(/\.jpg$/, ''), size, fallback);
	if (!gravatar) {
		// A 404 only when the caller explicitly asked for one; otherwise this URL keeps its promise
		// of always returning an image, with Passport's own neutral silhouette. Short cache, so the
		// real Gravatar shows up again soon once it's reachable.
		if (fallback === '404') {
			error(404, 'Image introuvable.');
		}
		return new Response(new Uint8Array(DEFAULT_AVATAR_PNG), {
			headers: { ...baseHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' }
		});
	}

	return new Response(new Uint8Array(gravatar.bytes), {
		headers: {
			...baseHeaders,
			'Content-Type': gravatar.type,
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
