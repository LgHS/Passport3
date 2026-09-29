import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { getComptaSettings } from '$lib/server/compta/settings';
import { isMailConfigured } from '$lib/server/compta/mailer';
import { apercuRappel, envoyerRappel, listFacturesEchues, listRappels, RappelError } from '$lib/server/compta/rappels';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

const COMPLEMENT_MAX = 2000;

export const load: PageServerLoad = async () => {
	const [echues, rappels, settings, mailConfigured] = await Promise.all([
		listFacturesEchues(),
		listRappels(),
		getComptaSettings(),
		isMailConfigured()
	]);
	// The exact mail each invoice would get, so the treasurer validates what leaves, not a summary.
	const factures = await Promise.all(
		echues.map(async (f) => {
			const apercu = await apercuRappel(f.id);
			return { ...f, niveau: apercu?.niveau ?? f.rappelsEnvoyes + 1, to: apercu?.to ?? [], subject: apercu?.subject ?? '', text: apercu?.text ?? '' };
		})
	);
	return { factures, rappels, delai: settings.rappelDelaiJours, mailConfigured };
};

export const actions: Actions = {
	// Sends the reminders the treasurer ticked, one mail per invoice. One failing doesn't stop the
	// others; the result says which left and which didn't.
	envoyer: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const ids = [...new Set(formData.getAll('factureId').map(Number))].filter((n) => Number.isInteger(n) && n > 0);
		if (ids.length === 0) return fail(400, { error: 'Cochez au moins une facture.' });
		const complement = String(formData.get('complement') ?? '').trim();
		if (complement.length > COMPLEMENT_MAX) return fail(400, { error: `Message complémentaire trop long (${COMPLEMENT_MAX} caractères max).` });

		const envoyes: { numero: string | null; to: string }[] = [];
		const echecs: string[] = [];
		for (const id of ids) {
			try {
				const rappel = await envoyerRappel(id, displayName(tresorier), complement || null);
				envoyes.push({ numero: rappel.factureNumero, to: rappel.envoyeA });
				await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.rappel.envoyer', {}, {
					factureId: id,
					numero: rappel.factureNumero,
					niveau: rappel.niveau,
					to: rappel.envoyeA
				});
			} catch (err) {
				if (!(err instanceof RappelError)) throw err;
				echecs.push(err.message);
			}
		}
		if (envoyes.length === 0) return fail(400, { error: echecs.join(' '), echecs });
		return { envoyes, echecs };
	}
};
