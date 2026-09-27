import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTresorier } from '$lib/server/auth';
import { getFacture, readFacturePdf } from '$lib/server/compta/factures';

// Treasury download of any invoice's stored PDF. Members get theirs through
// /cotisation/invoice/[id], which checks ownership.
export const GET: RequestHandler = async ({ params, locals }) => {
	requireTresorier(locals);
	const id = Number(params.id);
	const facture = Number.isInteger(id) && id > 0 ? await getFacture(id) : null;
	const pdf = facture ? await readFacturePdf(facture.id) : null;
	if (!facture || !pdf) error(404, 'Document introuvable.');

	const name = (facture.numero ?? `facture-${facture.id}`).replace(/[^A-Za-z0-9._-]/g, '_');
	return new Response(pdf as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${name}.pdf"`
		}
	});
};
