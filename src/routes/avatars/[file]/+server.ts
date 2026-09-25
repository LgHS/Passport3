import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAvatarFileName, readAvatar } from '$lib/server/avatars';

// Public on purpose: Authentik and BookStack load these URLs directly, from a browser or a server
// that isn't logged into Passport, keyed by the md5 hash of the member's email — the same scheme
// as Gravatar (see avatars.ts). Anyone who knows a member's email can therefore fetch their photo.
//
// Always answers with an image: the member's uploaded photo if there is one, otherwise their
// Gravatar, fetched and served by Passport itself (so those services only ever deal with this one
// URL, and the member's browser never talks to Gravatar). `d` picks Gravatar's fallback when the
// member has no Gravatar either — `mp` (a neutral silhouette) by default; `d=404` is still
// available for a caller that wants to fall through to its own fallback (e.g. Authentik initials).

const GRAVATAR_TIMEOUT_MS = 5_000;
const GRAVATAR_CACHE_TTL_MS = 60 * 60 * 1000;
const GRAVATAR_CACHE_MAX_ENTRIES = 500;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

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
		res = await fetch(url, { signal: AbortSignal.timeout(GRAVATAR_TIMEOUT_MS) });
	} catch {
		error(502, 'Gravatar est injoignable.');
	}
	// Only happens with d=404 and no Gravatar: the caller asked for a 404 in that case.
	if (res.status === 404) return null;
	const type = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
	if (!res.ok || !IMAGE_TYPES.has(type)) {
		error(502, 'Réponse Gravatar inattendue.');
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
		error(404, 'Image introuvable.');
	}

	return new Response(new Uint8Array(gravatar.bytes), {
		headers: {
			...baseHeaders,
			'Content-Type': gravatar.type,
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
