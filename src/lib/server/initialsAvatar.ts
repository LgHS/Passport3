import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';
import fontDataUrl from '$lib/server/fonts/OpenSans-Bold.ttf?inline';

// Draws a member's initials on a solid background, as a PNG — the avatar shown for anyone who
// hasn't uploaded a photo (see /avatars/[file]). An SVG rendered by resvg, a self-contained Rust
// renderer shipped as a prebuilt binary, with the site's own typeface embedded rather than relying
// on fonts installed in the container (the runtime image has none).
const SIZE = 512;

// Muted tones, all readable with white text (contrast >= 3:1, the WCAG threshold for large text):
// distinguishable from one another without being loud. A member always gets the same one, picked
// from their email hash.
const PALETTE = [
	'#5B7083',
	'#6B8F71',
	'#A26D5A',
	'#8A6F8F',
	'#9C7B45',
	'#4F7C82',
	'#7D7461',
	'#6C7A9C',
	'#9A6B6B',
	'#5F7F5F',
	'#80708A',
	'#7F7048'
];

const font = Buffer.from(fontDataUrl.slice(fontDataUrl.indexOf(',') + 1), 'base64');

// `fontBuffers` is supported by the native binding (checked: text renders with it, not without)
// but missing from resvg-js's own typings, hence the cast.
const RENDER_OPTIONS = {
	font: { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: 'Open Sans' }
} as ResvgRenderOptions;

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderInitialsAvatar(hash: string, initials: string): Buffer {
	const background = PALETTE[parseInt(hash.slice(0, 8), 16) % PALETTE.length];
	// One letter gets a bigger glyph than two, so both fill the square about as much.
	const fontSize = [...initials].length > 1 ? 200 : 240;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
	<rect width="${SIZE}" height="${SIZE}" fill="${background}"/>
	<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Open Sans" font-weight="700" font-size="${fontSize}" fill="#ffffff">${escapeXml(initials)}</text>
</svg>`;
	return new Resvg(svg, RENDER_OPTIONS).render().asPng();
}
