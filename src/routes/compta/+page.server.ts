import type { PageServerLoad } from './$types';
import { listSituations } from '$lib/server/compta/cotisations';
import { tiersDisplayName } from '$lib/server/compta/tiers';
import type { CotisationStatus } from '$lib/types';

export interface MembreOverview {
	id: number;
	nom: string;
	email: string | null;
	hasAccount: boolean;
	status: CotisationStatus;
	datefin: Date | null;
	via: string | null;
}

export const load: PageServerLoad = async () => {
	const situations = await listSituations();

	const membres: MembreOverview[] = situations
		.filter(({ tiers }) => tiers.nature === 'personne_physique' && tiers.actif)
		.map(({ tiers, situation }) => ({
			id: tiers.id,
			nom: tiersDisplayName(tiers),
			email: tiers.email,
			hasAccount: tiers.authentikPk !== null,
			status: situation.status,
			datefin: situation.datefin,
			via: situation.via
		}));

	const counts: Record<CotisationStatus, number> = {
		a_jour: 0,
		en_grace: 0,
		en_attente: 0,
		expiree: 0,
		non_applicable: 0
	};
	for (const m of membres) counts[m.status] += 1;

	return {
		membres,
		counts,
		organisations: situations.filter(({ tiers }) => tiers.nature === 'personne_morale' && tiers.actif).length
	};
};
