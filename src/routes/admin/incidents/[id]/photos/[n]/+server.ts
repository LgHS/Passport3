import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { readIncidentPhoto } from '$lib/server/incidentPhotos';

// A declaration's photo, admins only. A +server.ts isn't covered by admin/+layout.server.ts, hence
// the explicit check here.
export const GET: RequestHandler = ({ params, locals }) => {
	requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) error(404);
	const photo = readIncidentPhoto(id, Number(params.n));
	if (!photo) error(404);
	return new Response(new Uint8Array(photo), {
		headers: {
			'Content-Type': 'image/jpeg',
			// Sensitive: never kept by a shared cache.
			'Cache-Control': 'private, no-store'
		}
	});
};
