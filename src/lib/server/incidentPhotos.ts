import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '$lib/server/db';
import { jpegDimensions } from '$lib/server/avatars';
import {
	INCIDENT_MAX_PHOTOS,
	INCIDENT_PHOTO_MAX_BYTES,
	INCIDENT_PHOTO_MAX_SIDE
} from '$lib/incidentDisplay';

// Photos of a declaration, stored next to the avatars on the data volume:
// DATA_DIR/incidents/<incident id>/<1..3>.jpg. They can show an injury, so they are never served
// as static files — only through /admin/incidents/[id]/photos/[n], which checks for an admin.
const INCIDENTS_DIR = join(DATA_DIR, 'incidents');

const photoPath = (incidentId: number, n: number) => join(INCIDENTS_DIR, String(incidentId), `${n}.jpg`);

export async function validateIncidentPhotos(
	formData: FormData
): Promise<{ ok: true; photos: Uint8Array[] } | { ok: false; error: string }> {
	const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
	if (files.length > INCIDENT_MAX_PHOTOS) {
		return { ok: false, error: `${INCIDENT_MAX_PHOTOS} photos maximum.` };
	}
	const photos: Uint8Array[] = [];
	for (const file of files) {
		if (file.size > INCIDENT_PHOTO_MAX_BYTES) return { ok: false, error: 'Photo trop lourde.' };
		const bytes = new Uint8Array(await file.arrayBuffer());
		// Same check as the avatars: a real JPEG, of the size the browser was asked to produce.
		const dimensions = jpegDimensions(bytes);
		if (
			!dimensions ||
			Math.max(dimensions.width, dimensions.height) > INCIDENT_PHOTO_MAX_SIDE ||
			Math.min(dimensions.width, dimensions.height) < 1
		) {
			return { ok: false, error: 'Format de photo invalide.' };
		}
		photos.push(bytes);
	}
	return { ok: true, photos };
}

// Temp name then rename, owner-only permissions: same as saveAvatar().
export function saveIncidentPhotos(incidentId: number, photos: Uint8Array[]): void {
	if (photos.length === 0) return;
	const dir = join(INCIDENTS_DIR, String(incidentId));
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	photos.forEach((bytes, i) => {
		const tmpPath = join(dir, `${randomBytes(8).toString('hex')}.tmp`);
		writeFileSync(tmpPath, bytes, { mode: 0o600 });
		renameSync(tmpPath, photoPath(incidentId, i + 1));
	});
}

// The photo numbers (1..3) a declaration has.
export function listIncidentPhotos(incidentId: number): number[] {
	const numbers: number[] = [];
	for (let n = 1; n <= INCIDENT_MAX_PHOTOS; n++) {
		if (existsSync(photoPath(incidentId, n))) numbers.push(n);
	}
	return numbers;
}

export function readIncidentPhoto(incidentId: number, n: number): Buffer | null {
	if (!Number.isInteger(n) || n < 1 || n > INCIDENT_MAX_PHOTOS) return null;
	try {
		return readFileSync(photoPath(incidentId, n));
	} catch {
		return null;
	}
}
