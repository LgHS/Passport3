import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getHistoriquePaiements } from '$lib/server/compta/paiements';
import { getComptaSettings } from '$lib/server/compta/settings';
import { listOrganisationsAdministrees, resolveTiersForUser, tiersDisplayName } from '$lib/server/compta/tiers';

// The member's own payments and those of the organisations they administer — the same scope as
// the invoices on /cotisation. Always re-derived from the session, never from a parameter.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const tiers = await resolveTiersForUser(locals.user);
	if (!tiers) return { found: false as const };

	const [organisations, settings] = await Promise.all([listOrganisationsAdministrees(tiers.id), getComptaSettings()]);
	const historique = await getHistoriquePaiements(
		tiers.id,
		organisations.map((o) => ({ id: o.id, nom: tiersDisplayName(o) }))
	);
	return {
		found: true as const,
		...historique,
		// To pay what is still owed: the ASBL's account, the communication is per invoice.
		iban: settings.emetteurIban || null
	};
};
