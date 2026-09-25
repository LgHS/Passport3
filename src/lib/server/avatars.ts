import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getDb } from '$lib/server/db';

// Member-uploaded profile photos, stored on local disk next to the SQLite database (same volume).
// A member with an uploaded photo gets it everywhere Passport shows an avatar (header, /profile,
// admin, trombinoscope) instead of their Gravatar; deleting it falls back to Gravatar again.
//
// The browser does the square crop and resize itself (AvatarUpload.svelte) and sends a small
// JPEG — the server doesn't re-encode images, so it only accepts exactly that shape: a JPEG of
// AVATAR_SIZE x AVATAR_SIZE under AVATAR_MAX_BYTES, checked from the file's own bytes rather than
// trusting the client's filename or Content-Type.
export const AVATAR_SIZE = 256;
const AVATAR_MAX_BYTES = 200 * 1024;

const AVATAR_DIR = join(DATA_DIR, 'avatars');
// Random, unguessable names: an avatar URL is only ever handed out where the member's own
// visibility settings allow it (see listDirectoryMembers), so knowing a member's pk isn't enough to
// fetch their photo directly. A new name on every upload also makes the URL safe to cache forever.
const AVATAR_FILE_RE = /^[a-f0-9]{32}\.jpg$/;

function avatarUrl(file: string): string {
	return `/avatars/${file}`;
}

export function getLocalAvatarUrl(pk: number): string | null {
	const row = getDb().prepare('SELECT file FROM member_avatars WHERE member_pk = ?').get(pk) as
		| { file: string }
		| undefined;
	return row ? avatarUrl(row.file) : null;
}

// One query for the whole trombinoscope instead of one per member.
export function getLocalAvatarUrls(): Map<number, string> {
	const rows = getDb().prepare('SELECT member_pk, file FROM member_avatars').all() as {
		member_pk: number;
		file: string;
	}[];
	return new Map(rows.map((row) => [row.member_pk, avatarUrl(row.file)]));
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

// Written to a temp name then renamed, so a crash mid-write never leaves a truncated file behind a
// row that points at it. Owner-only permissions: the volume holds member data, not public assets.
export function saveAvatar(pk: number, bytes: Uint8Array): void {
	mkdirSync(AVATAR_DIR, { recursive: true, mode: 0o700 });
	const file = `${randomBytes(16).toString('hex')}.jpg`;
	const tmpPath = join(AVATAR_DIR, `${file}.tmp`);
	writeFileSync(tmpPath, bytes, { mode: 0o600 });
	renameSync(tmpPath, join(AVATAR_DIR, file));

	const previous = getDb().prepare('SELECT file FROM member_avatars WHERE member_pk = ?').get(pk) as
		| { file: string }
		| undefined;
	getDb()
		.prepare(
			`INSERT INTO member_avatars (member_pk, file) VALUES (?, ?)
			 ON CONFLICT(member_pk) DO UPDATE SET file = excluded.file,
			 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
		)
		.run(pk, file);
	if (previous) removeFile(previous.file);
}

// Returns whether there was anything to delete, so callers only audit-log real changes.
export function deleteAvatar(pk: number): boolean {
	const previous = getDb().prepare('SELECT file FROM member_avatars WHERE member_pk = ?').get(pk) as
		| { file: string }
		| undefined;
	if (!previous) return false;
	getDb().prepare('DELETE FROM member_avatars WHERE member_pk = ?').run(pk);
	removeFile(previous.file);
	return true;
}

// Null for anything that isn't one of our own file names, so a crafted path can never escape
// AVATAR_DIR.
export function readAvatar(file: string): Buffer | null {
	if (!AVATAR_FILE_RE.test(file)) return null;
	try {
		return readFileSync(join(AVATAR_DIR, file));
	} catch {
		return null;
	}
}
