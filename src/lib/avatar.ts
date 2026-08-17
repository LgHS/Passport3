// Authentik's `avatar` field is a Gravatar URL with a fixed `size` query param (158px, as of this
// instance) — too small for contexts that display it larger (e.g. the trombinoscope grid's
// full-width square cards), causing the browser to upscale and blur it. Overriding the param here
// asks Gravatar directly for a size matching where it's actually rendered, rather than stretching
// whatever Authentik happened to request.
export function avatarSize(url: string, size: number): string {
	try {
		const parsed = new URL(url);
		parsed.searchParams.set('size', String(size));
		return parsed.toString();
	} catch {
		return url;
	}
}
