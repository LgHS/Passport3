import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTresorier } from '$lib/server/auth';
import { getFacture, readFactureUbl } from '$lib/server/compta/factures';

// The UBL (Peppol BIS 3.0) file of an issued invoice, for the treasurer to drop on Doccle — or, for
// a received invoice, the supplier's own file as it was imported.
export const GET: RequestHandler = async ({ params, locals }) => {
	requireTresorier(locals);
	const id = Number(params.id);
	const facture = Number.isInteger(id) && id > 0 ? await getFacture(id) : null;
	const ubl = facture ? await readFactureUbl(facture.id) : null;
	if (!facture || !ubl) error(404, 'Document introuvable.');

	const name = (facture.numero ?? `facture-${facture.id}`).replace(/[^A-Za-z0-9._-]/g, '_');
	return new Response(ubl as BodyInit, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Content-Disposition': `attachment; filename="${name}.xml"`
		}
	});
};
