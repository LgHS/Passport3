// Authentik's `avatar` field is usually a Gravatar URL with a fixed `size` query param (158px, as
// of this instance) — too small for contexts that display it larger (e.g. the trombinoscope
// grid's full-width square cards), causing the browser to upscale and blur it. Overriding the
// param here asks Gravatar directly for a size matching where it's actually rendered, rather than
// stretching whatever Authentik happened to request.
//
// But for a member with no matching Gravatar, Authentik falls back to its own "initials" avatar
// mode instead — a `data:image/svg+xml;base64,...` URI with the image embedded inline, not a real
// URL to a Gravatar endpoint. `new URL()` on that still succeeds (a data URI is a valid URL), but
// `searchParams.set()` then appends `?size=...` *after* the base64 payload, corrupting it — the
// browser fails to decode it and shows a broken image. Data URIs have no separate "size" to
// request anyway (the SVG already scales via its container's own width/height classes), so they
// pass through untouched.
export function avatarSize(url: string, size: number): string {
	if (url.startsWith('data:')) return url;
	try {
		const parsed = new URL(url);
		parsed.searchParams.set('size', String(size));
		return parsed.toString();
	} catch {
		return url;
	}
}
