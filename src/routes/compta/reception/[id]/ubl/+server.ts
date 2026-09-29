import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTresorier } from '$lib/server/auth';
import { readDocumentFichier } from '$lib/server/compta/reception';

// A collected document's file, for the treasurer to look at before importing. Served as a
// download, never inline: it comes from an email.
export const GET: RequestHandler = async ({ params, locals }) => {
	requireTresorier(locals);
	const id = Number(params.id);
	const fichier = Number.isInteger(id) && id > 0 ? await readDocumentFichier(id, 'ubl') : null;
	if (!fichier) error(404, 'Document introuvable.');
	const name = fichier.nom.replace(/[^A-Za-z0-9._-]/g, '_');
	return new Response(fichier.bytes as BodyInit, {
		headers: {
			'Content-Type': 'application/xml',
			'Content-Disposition': `attachment; filename="${name}"`,
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
