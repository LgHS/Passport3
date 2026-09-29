import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTresorier } from '$lib/server/auth';
import { getJournal } from '$lib/server/compta/journal';
import { getComptesAnnuels, renderComptesAnnuelsPdf } from '$lib/server/compta/comptesAnnuels';
import { getComptaSettings } from '$lib/server/compta/settings';

// The year's annual accounts in the official minimum model, rendered on demand from the books
// and from what the treasurer typed for the annexe — the document to have approved by the
// general assembly and filed.
export const GET: RequestHandler = async ({ url, locals }) => {
	requireTresorier(locals);
	const annee = Number(url.searchParams.get('annee'));
	if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) error(400, 'Année invalide.');
	const [journal, comptes, settings] = await Promise.all([getJournal(annee), getComptesAnnuels(annee), getComptaSettings()]);
	const pdf = await renderComptesAnnuelsPdf(journal, comptes, settings);
	return new Response(pdf as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="comptes-annuels-${annee}.pdf"`
		}
	});
};
