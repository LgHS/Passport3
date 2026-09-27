import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { getComptaSettings, updateComptaSettings } from '$lib/server/compta/settings';
import { isValidIban, normalizeIban } from '$lib/server/bankValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

export const load: PageServerLoad = async () => {
	return { settings: await getComptaSettings() };
};

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const str = (key: string) => String(formData.get(key) ?? '').trim();

		const delaiGraceJours = Number(formData.get('delaiGraceJours'));
		const delaiPaiementJours = Number(formData.get('delaiPaiementJours'));
		const emetteurIban = normalizeIban(str('emetteurIban'));
		const values = {
			delaiGraceJours,
			delaiPaiementJours,
			emetteurNom: str('emetteurNom'),
			emetteurAdresse: str('emetteurAdresse'),
			emetteurNumeroEntreprise: str('emetteurNumeroEntreprise'),
			emetteurEmail: str('emetteurEmail'),
			emetteurIban,
			mentionTva: str('mentionTva'),
			desactivationAuto: formData.has('desactivationAuto')
		};

		if (!Number.isInteger(delaiGraceJours) || delaiGraceJours < 0 || delaiGraceJours > 365) {
			return fail(400, { error: 'Délai de grâce invalide (0 à 365 jours).', values });
		}
		if (!Number.isInteger(delaiPaiementJours) || delaiPaiementJours < 0 || delaiPaiementJours > 365) {
			return fail(400, { error: 'Délai de paiement invalide (0 à 365 jours).', values });
		}
		if (!values.emetteurNom) return fail(400, { error: 'Le nom de l’émetteur est obligatoire.', values });
		if (emetteurIban && !isValidIban(emetteurIban)) return fail(400, { error: 'IBAN invalide (vérifiez le numéro).', values });
		if (!values.mentionTva) return fail(400, { error: 'La mention TVA est obligatoire sur les factures.', values });

		await updateComptaSettings(values);
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.settings.update', {}, {
			delaiGraceJours,
			delaiPaiementJours,
			desactivationAuto: values.desactivationAuto
		});
		return { success: true, values };
	}
};
