import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTresorier } from '$lib/server/auth';
import { readJustificatif } from '$lib/server/compta/notesDeFrais';

export const GET: RequestHandler = async ({ params, locals }) => {
	requireTresorier(locals);
	const id = Number(params.id);
	const doc = Number.isInteger(id) && id > 0 ? await readJustificatif(id) : null;
	if (!doc) error(404, 'Justificatif introuvable.');
	return new Response(doc.bytes as BodyInit, {
		headers: {
			'Content-Type': doc.type,
			'Content-Disposition': `inline; filename="${doc.nom.replace(/[^A-Za-z0-9._-]/g, '_')}"`
		}
	});
};
