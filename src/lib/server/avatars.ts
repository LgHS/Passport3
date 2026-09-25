import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getDb } from '$lib/server/db';
import { PALETTE_SIZE, renderInitialsAvatar } from '$lib/server/initialsAvatar';

// Member-uploaded profile photos, stored on local disk next to the SQLite database (same volume).
// A member with an uploaded photo gets it everywhere Passport shows an avatar (header, /profile,
// admin, trombinoscope); without one, an image of their initials is generated instead (see
// getGeneratedAvatar below). Gravatar is not used at all.
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
// If a member's email ever changes, their file has to be renamed along with it (saveAvatar does
// this on the next upload; an email-change tool should call renameAvatar).
const AVATAR_FILE_RE = /^[a-f0-9]{32}\.jpg$/;

export function emailHash(email: string): string {
	return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

// `?v=` changes with every upload, so Passport's own pages never show a stale photo even though
// the file name itself stays the same for a given email.
function avatarUrl(file: string, updatedAt: string): string {
	return `/avatars/${file}?v=${Date.parse(updatedAt) || 0}`;
}

type AvatarRow = { member_pk: number; file: string; updated_at: string };

function getRow(pk: number): AvatarRow | undefined {
	return getDb()
		.prepare('SELECT member_pk, file, updated_at FROM member_avatars WHERE member_pk = ?')
		.get(pk) as AvatarRow | undefined;
}

export function getLocalAvatarUrl(pk: number): string | null {
	const row = getRow(pk);
	return row ? avatarUrl(row.file, row.updated_at) : null;
}

// One query for the whole trombinoscope instead of one per member.
export function getLocalAvatarUrls(): Map<number, string> {
	const rows = getDb().prepare('SELECT member_pk, file, updated_at FROM member_avatars').all() as AvatarRow[];
	return new Map(rows.map((row) => [row.member_pk, avatarUrl(row.file, row.updated_at)]));
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

function removeFile(file: string): void {
	if (!AVATAR_FILE_RE.test(file)) return;
	rmSync(join(AVATAR_DIR, file), { force: true });
}

// Written to a random temp name then renamed over the final one, so a crash mid-write never leaves
// a truncated file, and a reader never sees a half-written replacement. Owner-only permissions:
// the volume holds member data.
export function saveAvatar(pk: number, email: string, bytes: Uint8Array): void {
	mkdirSync(AVATAR_DIR, { recursive: true, mode: 0o700 });
	const file = `${emailHash(email)}.jpg`;
	const tmpPath = join(AVATAR_DIR, `${randomBytes(8).toString('hex')}.tmp`);
	writeFileSync(tmpPath, bytes, { mode: 0o600 });
	renameSync(tmpPath, join(AVATAR_DIR, file));

	const previous = getRow(pk);
	getDb()
		.prepare(
			`INSERT INTO member_avatars (member_pk, file) VALUES (?, ?)
			 ON CONFLICT(member_pk) DO UPDATE SET file = excluded.file,
			 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
		)
		.run(pk, file);
	// Only differs when the member's email changed since their last upload.
	if (previous && previous.file !== file) removeFile(previous.file);
}

// For a future email-change tool: keeps the photo reachable under the new email's hash.
export function renameAvatar(pk: number, newEmail: string): void {
	const row = getRow(pk);
	if (!row) return;
	const file = `${emailHash(newEmail)}.jpg`;
	if (file === row.file) return;
	renameSync(join(AVATAR_DIR, row.file), join(AVATAR_DIR, file));
	getDb().prepare('UPDATE member_avatars SET file = ? WHERE member_pk = ?').run(file, pk);
}

// Returns whether there was anything to delete, so callers only audit-log real changes.
export function deleteAvatar(pk: number): boolean {
	const previous = getRow(pk);
	if (!previous) return false;
	getDb().prepare('DELETE FROM member_avatars WHERE member_pk = ?').run(pk);
	removeFile(previous.file);
	return true;
}

// Null for anything that isn't one of our own file names (so a crafted path can never escape
// AVATAR_DIR), or when that member has no uploaded photo.
export function readAvatar(file: string): { bytes: Buffer; modifiedAt: Date } | null {
	if (!AVATAR_FILE_RE.test(file)) return null;
	const path = join(AVATAR_DIR, file);
	try {
		return { bytes: readFileSync(path), modifiedAt: statSync(path).mtime };
	} catch {
		return null;
	}
}

export function isAvatarFileName(file: string): boolean {
	return AVATAR_FILE_RE.test(file);
}

function getVariant(hash: string): number {
	const row = getDb().prepare('SELECT variant FROM avatar_variants WHERE email_hash = ?').get(hash) as
		| { variant: number }
		| undefined;
	return row?.variant ?? 0;
}

// URL of a member's generated initials avatar. `?c=` changes with the chosen colour, so Passport's
// own pages show a new colour right away despite the URL otherwise staying the same.
export function generatedAvatarUrl(email: string): string {
	const hash = emailHash(email);
	const variant = getVariant(hash);
	return `/avatars/${hash}.jpg${variant ? `?c=${variant}` : ''}`;
}

// URL of a member's avatar, whichever it is: their uploaded photo, or their generated initials.
export function avatarUrlFor(pk: number, email: string | null | undefined): string | null {
	return getLocalAvatarUrl(pk) ?? (email ? generatedAvatarUrl(email) : null);
}

// "Changer de couleur": moves the member's generated avatar to another colour of the palette, at
// random but never the one currently shown. The cached image is replaced on the next request.
export function regenerateGeneratedAvatar(email: string): void {
	const hash = emailHash(email);
	const current = getVariant(hash) % PALETTE_SIZE;
	const next = (current + 1 + Math.floor(Math.random() * (PALETTE_SIZE - 1))) % PALETTE_SIZE;
	getDb()
		.prepare(
			`INSERT INTO avatar_variants (email_hash, variant) VALUES (?, ?)
			 ON CONFLICT(email_hash) DO UPDATE SET variant = excluded.variant`
		)
		.run(hash, next);
}

// The initials and colour variant are part of the cached file name, so a new username or a new
// colour gets a fresh image instead of a stale one; previous images are removed when it's written.
function generatedFile(hash: string, initials: string): { file: string; path: string; variant: number } {
	const variant = getVariant(hash);
	const file = `${hash}-${Buffer.from(initials).toString('hex')}-${variant}.png`;
	return { file, path: join(GENERATED_DIR, file), variant };
}

function writeGeneratedAvatar(hash: string, initials: string): Buffer {
	const { file, path, variant } = generatedFile(hash, initials);
	const png = renderInitialsAvatar(hash, initials, variant);
	mkdirSync(GENERATED_DIR, { recursive: true, mode: 0o700 });
	for (const old of readdirSync(GENERATED_DIR)) {
		if (old.startsWith(`${hash}-`) && old !== file) rmSync(join(GENERATED_DIR, old), { force: true });
	}
	const tmpPath = join(GENERATED_DIR, `${randomBytes(8).toString('hex')}.tmp`);
	writeFileSync(tmpPath, png, { mode: 0o600 });
	renameSync(tmpPath, path);
	return png;
}

export function getGeneratedAvatar(hash: string, initials: string): Buffer {
	const { path } = generatedFile(hash, initials);
	if (existsSync(path)) return readFileSync(path);
	return writeGeneratedAvatar(hash, initials);
}

export interface PregenerateResult {
	generated: number;
	alreadyCached: number;
	withPhoto: number;
}

// Admin bulk action: makes sure every member without an uploaded photo already has their initials
// image on disk, instead of waiting for its first request (e.g. before pointing Authentik or
// BookStack at Passport). Idempotent: images already cached are left alone.
export function pregenerateAvatars(initialsByHash: Map<string, string>): PregenerateResult {
	const withPhoto = new Set(
		(getDb().prepare('SELECT file FROM member_avatars').all() as { file: string }[]).map((row) =>
			row.file.replace(/\.jpg$/, '')
		)
	);
	const result: PregenerateResult = { generated: 0, alreadyCached: 0, withPhoto: 0 };
	for (const [hash, initials] of initialsByHash) {
		if (withPhoto.has(hash)) {
			result.withPhoto++;
		} else if (existsSync(generatedFile(hash, initials).path)) {
			result.alreadyCached++;
		} else {
			writeGeneratedAvatar(hash, initials);
			result.generated++;
		}
	}
	return result;
}
