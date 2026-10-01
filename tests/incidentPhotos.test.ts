import { describe, expect, it } from 'vitest';
import { validateIncidentPhotos } from '$lib/server/incidentPhotos';
import { INCIDENT_MAX_PHOTOS, INCIDENT_PHOTO_MAX_BYTES, INCIDENT_PHOTO_MAX_SIDE } from '$lib/incidentDisplay';

// Just enough of a JPEG for the validator: SOI, then a SOF0 segment carrying the dimensions.
function fakeJpeg(width: number, height: number, padding = 0): File {
	const bytes = new Uint8Array([
		0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
		height >> 8, height & 0xff, width >> 8, width & 0xff,
		0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
		...new Array(padding).fill(0)
	]);
	return new File([bytes], 'photo.jpg', { type: 'image/jpeg' });
}

function withPhotos(...files: File[]): FormData {
	const formData = new FormData();
	for (const file of files) formData.append('photos', file);
	return formData;
}

describe('validateIncidentPhotos', () => {
	it('accepte une déclaration sans photo', async () => {
		const result = await validateIncidentPhotos(new FormData());
		expect(result.ok && result.photos.length).toBe(0);
	});

	it('accepte jusqu’au maximum de photos', async () => {
		const files = Array.from({ length: INCIDENT_MAX_PHOTOS }, () => fakeJpeg(1280, 960));
		const result = await validateIncidentPhotos(withPhotos(...files));
		expect(result.ok && result.photos.length).toBe(INCIDENT_MAX_PHOTOS);
	});

	it('refuse une photo de trop', async () => {
		const files = Array.from({ length: INCIDENT_MAX_PHOTOS + 1 }, () => fakeJpeg(800, 600));
		expect((await validateIncidentPhotos(withPhotos(...files))).ok).toBe(false);
	});

	it('refuse une photo trop lourde', async () => {
		const heavy = fakeJpeg(800, 600, INCIDENT_PHOTO_MAX_BYTES);
		expect((await validateIncidentPhotos(withPhotos(heavy))).ok).toBe(false);
	});

	it('refuse une photo plus grande que la taille demandée au navigateur', async () => {
		const tooWide = fakeJpeg(INCIDENT_PHOTO_MAX_SIDE + 1, 600);
		expect((await validateIncidentPhotos(withPhotos(tooWide))).ok).toBe(false);
	});

	it('refuse un fichier qui n’est pas un JPEG', async () => {
		const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])], 'x.png');
		expect((await validateIncidentPhotos(withPhotos(png))).ok).toBe(false);
	});
});
