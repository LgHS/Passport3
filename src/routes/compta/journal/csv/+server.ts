import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTresorier } from '$lib/server/auth';
import { getJournal, journalCsv } from '$lib/server/compta/journal';

// The year's journal as a spreadsheet for the accountant (semicolons, Belgian decimals, BOM so
// Excel opens it as UTF-8).
export const GET: RequestHandler = async ({ url, locals }) => {
	requireTresorier(locals);
	const annee = Number(url.searchParams.get('annee'));
	if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) error(400, 'Année invalide.');
	const csv = journalCsv(await getJournal(annee));
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="journal-${annee}.csv"`
		}
	});
};
