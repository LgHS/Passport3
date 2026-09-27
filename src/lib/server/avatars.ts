import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '$lib/server/db';
import { renderInitialsAvatar } from '$lib/server/initialsAvatar';

// Member avatars, served by Passport itself at /avatars/<hash>.jpg — no database involved: the
// disk says whether a member uploaded a photo, and Authentik (see authentikAdmin.ts's
// getAvatarInfoByEmailHash) says what their generated initials look like. A Postgres outage
// therefore never affects avatars.
// - A member with an uploaded photo gets it everywhere Passport shows an avatar (header, /profile,
//   admin, trombinoscope, and Authentik/BookStack through the same URL).
// - Without one, an image of their initials is generated instead (see getGeneratedAvatar below).
// Gravatar is not used at all.
//
// The browser does the square crop and resize itself (AvatarEditor.svelte) and sends a JPEG — the
// server doesn't re-encode images, so it only accepts exactly that shape: a JPEG of
// AVATAR_SIZE x AVATAR_SIZE under AVATAR_MAX_BYTES, checked from the file's own bytes rather than
// trusting the client's filename or Content-Type.
export const AVATAR_SIZE = 512;
const AVATAR_MAX_BYTES = 400 * 1024;

const AVATAR_DIR = join(DATA_DIR, 'avatars');
// Initials images, generated on first request and kept on disk — they're only a cache, safe to
// delete at any time (they're regenerated on the next request).
const GENERATED_DIR = join(AVATAR_DIR, 'generated');

// Files are named after the Gravatar-style hash of the member's email — md5 of the trimmed,
// lowercased address — so other services can point at the same photo from the email alone:
// Authentik's avatar setting (`https://<passport>/avatars/%(mail_hash)s.jpg`) and BookStack's
// AVATAR_URL (`https://<passport>/avatars/${hash}.jpg`) use that exact hash. The flip side is that
// the photo is as public as a Gravatar: anyone who knows a member's email can compute its URL.
// If a member's email ever changes, their file has to be renamed along with it (an email-change
// tool should call renameAvatar).
const AVATAR_FILE_RE = /^[a-f0-9]{32}\.jpg$/;

export function emailHash(email: string): string {
	return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

export function isAvatarFileName(file: string): boolean {
	return AVATAR_FILE_RE.test(file);
}

function photoPath(hash: string): string {
	return join(AVATAR_DIR, `${hash}.jpg`);
}

export function hasUploadedAvatar(email: string | null | undefined): boolean {
	return !!email && existsSync(photoPath(emailHash(email)));
}

// URL of a member's avatar, whichever it is. The path itself never changes for a given email; the
// query string only changes when the image does (the photo's modification time, or the chosen
// colour), so a page that just re-rendered after an upload or a colour change shows the new image
// instead of the one the browser already holds for that URL. Other pages and other services pick
// up changes anyway: the endpoint makes every cache revalidate (ETag, see /avatars/[file]).
export function avatarUrlFor(email: string | null | undefined, variant = 0): string | null {
	if (!email) return null;
	const hash = emailHash(email);
	try {
		return `/avatars/${hash}.jpg?v=${Math.floor(statSync(photoPath(hash)).mtimeMs)}`;
	} catch {
		return `/avatars/${hash}.jpg${variant ? `?c=${variant}` : ''}`;
	}
}

// Walks the JPEG markers up to the first SOF (start of frame) segment, which carries the image
// dimensions. Returns null for anything that isn't a well-formed baseline/progressive JPEG.
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
		if (length < 2) return null;
		// SOF0..SOF15, minus DHT (C4), JPG (C8) and DAC (CC), which share that range.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return {
				height: (bytes[offset + 5] << 8) | bytes[offset + 6],
				width: (bytes[offset + 7] << 8) | bytes[offset + 8]
			};
		}
		offset += 2 + length;
	}
	return null;
}

export function validateAvatarUpload(bytes: Uint8Array): { ok: true } | { ok: false; error: string } {
	if (bytes.length === 0) return { ok: false, error: 'Aucune image reçue.' };
	if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, error: 'Image trop lourde.' };
	const dimensions = jpegDimensions(bytes);
	if (!dimensions || dimensions.width !== AVATAR_SIZE || dimensions.height !== AVATAR_SIZE) {
		return { ok: false, error: 'Format d’image invalide.' };
	}
	return { ok: true };
}

// Written to a random temp name then renamed over the final one, so a crash mid-write never leaves
// a truncated file, and a reader never sees a half-written replacement. Owner-only permissions:
// the volume holds member data.
export function saveAvatar(email: string, bytes: Uint8Array): void {
	mkdirSync(AVATAR_DIR, { recursive: true, mode: 0o700 });
	const tmpPath = join(AVATAR_DIR, `${randomBytes(8).toString('hex')}.tmp`);
	writeFileSync(tmpPath, bytes, { mode: 0o600 });
	renameSync(tmpPath, photoPath(emailHash(email)));
}

// For a future email-change tool: keeps the photo reachable under the new email's hash.
export function renameAvatar(oldEmail: string, newEmail: string): void {
	const from = photoPath(emailHash(oldEmail));
	const to = photoPath(emailHash(newEmail));
	if (from !== to && existsSync(from)) renameSync(from, to);
}

// Returns whether there was anything to delete, so callers only audit-log real changes.
export function deleteAvatar(email: string): boolean {
	const path = photoPath(emailHash(email));
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	return true;
}

// The uploaded photo's metadata only — enough to answer a conditional request (304) without
// reading the file. Null for anything that isn't one of our own file names (so a crafted path can
// never escape AVATAR_DIR), or when that member has no uploaded photo.
export function statAvatar(file: string): { path: string; size: number; modifiedAt: Date } | null {
	if (!AVATAR_FILE_RE.test(file)) return null;
	const path = join(AVATAR_DIR, file);
	try {
		const stats = statSync(path);
		return { path, size: stats.size, modifiedAt: stats.mtime };
	} catch {
		return null;
	}
}

// The initials and colour variant are part of the cached file name, so a new username or a new
// colour gets a fresh image instead of a stale one; previous images are removed when it's written.
// The file name also serves as the endpoint's ETag for generated images.
export function generatedFileName(hash: string, initials: string, variant: number): string {
	return `${hash}-${Buffer.from(initials).toString('hex')}-${variant}.png`;
}

function writeGeneratedAvatar(hash: string, initials: string, variant: number): Buffer {
	const file = generatedFileName(hash, initials, variant);
	const png = renderInitialsAvatar(hash, initials, variant);
	mkdirSync(GENERATED_DIR, { recursive: true, mode: 0o700 });
	for (const old of readdirSync(GENERATED_DIR)) {
		if (old.startsWith(`${hash}-`) && old !== file) rmSync(join(GENERATED_DIR, old), { force: true });
	}
	const tmpPath = join(GENERATED_DIR, `${randomBytes(8).toString('hex')}.tmp`);
	writeFileSync(tmpPath, png, { mode: 0o600 });
	renameSync(tmpPath, join(GENERATED_DIR, file));
	return png;
}

export function getGeneratedAvatar(hash: string, initials: string, variant: number): Buffer {
	const path = join(GENERATED_DIR, generatedFileName(hash, initials, variant));
	if (existsSync(path)) return readFileSync(path);
	return writeGeneratedAvatar(hash, initials, variant);
}

export interface AvatarInfo {
	initials: string;
	variant: number;
}

export interface PregenerateResult {
	generated: number;
	alreadyCached: number;
	withPhoto: number;
}

// Admin bulk action: makes sure every member without an uploaded photo already has their initials
// image on disk, instead of waiting for its first request (e.g. before pointing Authentik or
// BookStack at Passport). Idempotent: images already cached are left alone.
// Rendering is synchronous, so the loop hands control back to the event loop between images:
// generating a few hundred avatars never freezes the server for other requests.
export async function pregenerateAvatars(infoByHash: Map<string, AvatarInfo>): Promise<PregenerateResult> {
	const result: PregenerateResult = { generated: 0, alreadyCached: 0, withPhoto: 0 };
	for (const [hash, { initials, variant }] of infoByHash) {
		if (existsSync(photoPath(hash))) {
			result.withPhoto++;
		} else if (existsSync(join(GENERATED_DIR, generatedFileName(hash, initials, variant)))) {
			result.alreadyCached++;
		} else {
			writeGeneratedAvatar(hash, initials, variant);
			result.generated++;
			await new Promise((resolve) => setImmediate(resolve));
		}
	}
	return result;
}
