import type { PageServerLoad } from './$types';
import { listFactures, type FactureSens, type FactureStatut } from '$lib/server/compta/factures';

function parseSens(v: string | null): FactureSens | undefined {
	return v === 'emise' || v === 'recue' ? v : undefined;
}
function parseStatut(v: string | null): FactureStatut | undefined {
	return v === 'brouillon' || v === 'validee' || v === 'payee' || v === 'annulee' ? v : undefined;
}

export const load: PageServerLoad = async ({ url }) => {
	const sens = parseSens(url.searchParams.get('sens')) ?? 'emise';
	const statut = parseStatut(url.searchParams.get('statut'));
	return {
		sens,
		statut: statut ?? null,
		factures: await listFactures({ sens, statut })
	};
};
