import type { PageServerLoad } from './$types';
import { anneesDisponibles, getJournal } from '$lib/server/compta/journal';
import { brusselsToday } from '$lib/server/compta/dates';

export const load: PageServerLoad = async ({ url }) => {
	const annees = await anneesDisponibles();
	const courante = brusselsToday().getUTCFullYear();
	const demandee = Number(url.searchParams.get('annee'));
	const annee = Number.isInteger(demandee) && demandee > 2000 ? demandee : (annees[0] ?? courante);
	return { annees: annees.includes(courante) ? annees : [courante, ...annees], journal: await getJournal(annee) };
};
