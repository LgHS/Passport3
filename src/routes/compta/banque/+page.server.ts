import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { BanqueError, createCompte, listComptes, listMouvementsNonLettres, virementInterne } from '$lib/server/compta/banque';
import { brusselsToday, parseFormDate, parseFormMoney } from '$lib/server/compta/dates';
import { isValidIban, normalizeIban } from '$lib/server/bankValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

export const load: PageServerLoad = async () => {
	const [comptes, nonLettres] = await Promise.all([listComptes(), listMouvementsNonLettres(50)]);
	return { comptes, nonLettres };
};

export const actions: Actions = {
	createCompte: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const type = formData.get('type') === 'caisse' ? 'caisse' : 'banque';
		const nom = String(formData.get('nom') ?? '').trim();
		const iban = normalizeIban(String(formData.get('iban') ?? ''));
		const soldeOuverture = parseFormMoney(formData.get('soldeOuverture') || '0');
		const dateOuverture = formData.get('dateOuverture') ? parseFormDate(formData.get('dateOuverture')) : brusselsToday();
		const echo = { section: 'compte', values: Object.fromEntries(formData) as Record<string, string> };
		if (!nom) return fail(400, { ...echo, error: 'Le nom du compte est obligatoire.' });
		if (iban && !isValidIban(iban)) return fail(400, { ...echo, error: 'IBAN invalide.' });
		if (soldeOuverture === null) return fail(400, { ...echo, error: 'Solde d’ouverture invalide.' });
		if (!dateOuverture) return fail(400, { ...echo, error: 'Date d’ouverture invalide.' });

		const compte = await createCompte({ type, nom, iban: iban || null, soldeOuverture, dateOuverture, actif: true });
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.compte.create', {}, { compteId: compte.id, nom });
		return { section: 'compte', success: 'Compte créé.' };
	},

	virement: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const deId = Number(formData.get('deId'));
		const versId = Number(formData.get('versId'));
		const montant = parseFormMoney(formData.get('montant'));
		const dateValeur = formData.get('dateValeur') ? parseFormDate(formData.get('dateValeur')) : brusselsToday();
		const libelle = String(formData.get('libelle') ?? '');
		const echo = { section: 'virement', values: Object.fromEntries(formData) as Record<string, string> };
		if (!Number.isInteger(deId) || !Number.isInteger(versId)) return fail(400, { ...echo, error: 'Choisissez les deux comptes.' });
		if (montant === null || montant <= 0) return fail(400, { ...echo, error: 'Montant invalide.' });
		if (!dateValeur) return fail(400, { ...echo, error: 'Date invalide.' });
		try {
			const id = await virementInterne({ deId, versId, montant, dateValeur, libelle });
			await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.virement', {}, { transfertId: id, deId, versId, montant });
		} catch (err) {
			if (err instanceof BanqueError) return fail(400, { ...echo, error: err.message });
			throw err;
		}
		return { section: 'virement', success: 'Virement interne enregistré.' };
	}
};
