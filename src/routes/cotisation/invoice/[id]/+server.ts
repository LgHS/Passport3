import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getFacture, readFacturePdf } from '$lib/server/compta/factures';
import { listOrganisationsAdministrees, resolveTiersForUser } from '$lib/server/compta/tiers';

// Streams a member's own invoice PDF. Never trusts the route param on its own — the invoice is
// loaded and its tiers checked against the caller's own tiers and the organisations they
// administer before anything is returned, so a member can't guess another member's invoice id.
// "Not found" and "not yours" are the same 404 on purpose.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const factureId = Number(params.id);
	if (!Number.isInteger(factureId) || factureId <= 0) {
		error(404, 'Facture introuvable.');
	}

	const tiers = await resolveTiersForUser(locals.user);
	if (!tiers) {
		error(404, 'Facture introuvable.');
	}
	const organisations = await listOrganisationsAdministrees(tiers.id);
	const allowed = new Set([tiers.id, ...organisations.map((o) => o.id)]);

	const facture = await getFacture(factureId);
	if (!facture || facture.sens !== 'emise' || !allowed.has(facture.tiersId) || facture.statut === 'brouillon' || facture.statut === 'annulee') {
		error(404, 'Facture introuvable.');
	}
	const pdf = await readFacturePdf(facture.id);
	if (!pdf) {
		error(404, 'Facture introuvable.');
	}

	const name = (facture.numero ?? facture.referenceExterne ?? `facture-${facture.id}`).replace(/[^A-Za-z0-9._-]/g, '_');
	return new Response(pdf as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${name}.pdf"`
		}
	});
};
