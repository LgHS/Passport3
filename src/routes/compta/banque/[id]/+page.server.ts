import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { BanqueError, createMouvement, getCompte, importerMouvements, listMouvements, updateCompte } from '$lib/server/compta/banque';
import { BelfiusCsvError, parseBelfiusCsv } from '$lib/server/compta/belfiusCsv';
import { brusselsToday, parseFormDate, parseFormMoney } from '$lib/server/compta/dates';
import { isValidIban, normalizeIban } from '$lib/server/bankValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

// 5 MB — a year of statements is a few hundred KB.
const MAX_CSV_BYTES = 5 * 1024 * 1024;

async function loadCompte(params: { id: string }) {
	const id = Number(params.id);
	const compte = Number.isInteger(id) && id > 0 ? await getCompte(id) : null;
	if (!compte) error(404, 'Compte introuvable.');
	return compte;
}

export const load: PageServerLoad = async ({ params }) => {
	const compte = await loadCompte(params);
	return { compte, mouvements: await listMouvements(compte.id) };
};

export const actions: Actions = {
	importer: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const compte = await loadCompte(params);
		const formData = await request.formData();
		const file = formData.get('fichier');
		if (!(file instanceof File) || file.size === 0) return fail(400, { section: 'import', error: 'Choisissez un fichier CSV.' });
		if (file.size > MAX_CSV_BYTES) return fail(400, { section: 'import', error: 'Fichier trop volumineux (5 Mo max).' });

		let parsed;
		try {
			parsed = parseBelfiusCsv(new Uint8Array(await file.arrayBuffer()));
		} catch (err) {
			if (err instanceof BelfiusCsvError) return fail(400, { section: 'import', error: err.message });
			throw err;
		}
		// The file names an account: refuse to pour it into another one.
		if (parsed.compte && compte.iban && parsed.compte !== compte.iban) {
			return fail(400, { section: 'import', error: `Ce fichier concerne le compte ${parsed.compte}, pas ${compte.iban}.` });
		}
		if (parsed.mouvements.length === 0) {
			return fail(400, { section: 'import', error: 'Aucun mouvement lisible dans ce fichier.', erreurs: parsed.erreurs });
		}

		const result = await importerMouvements(compte.id, parsed.mouvements, { nomFichier: file.name, actorSub: tresorier.sub });
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.banque.import', {}, {
			compteId: compte.id,
			fichier: file.name,
			...result
		});
		return {
			section: 'import',
			success: `${result.nouvelles} mouvement(s) importé(s), ${result.ignorees} déjà connu(s), ${result.lettresAuto} lettré(s) automatiquement.`,
			erreurs: parsed.erreurs
		};
	},

	ajouter: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const compte = await loadCompte(params);
		const formData = await request.formData();
		const dateValeur = parseFormDate(formData.get('dateValeur')) ?? (formData.get('dateValeur') ? null : brusselsToday());
		const montantAbs = parseFormMoney(formData.get('montant'));
		const sens = formData.get('sens') === 'sortie' ? -1 : 1;
		const libelle = String(formData.get('libelle') ?? '').trim();
		const contrepartieIban = normalizeIban(String(formData.get('contrepartieIban') ?? ''));
		const echo = { section: 'mouvement', values: Object.fromEntries(formData) as Record<string, string> };
		if (!dateValeur) return fail(400, { ...echo, error: 'Date invalide.' });
		if (montantAbs === null || montantAbs <= 0) return fail(400, { ...echo, error: 'Montant invalide.' });
		if (!libelle) return fail(400, { ...echo, error: 'Le libellé est obligatoire.' });
		if (contrepartieIban && !isValidIban(contrepartieIban)) return fail(400, { ...echo, error: 'IBAN de contrepartie invalide.' });
		try {
			const m = await createMouvement({
				compteId: compte.id,
				dateValeur,
				montant: sens * montantAbs,
				libelle,
				contrepartieNom: String(formData.get('contrepartieNom') ?? '').trim() || null,
				contrepartieIban: contrepartieIban || null,
				communication: String(formData.get('communication') ?? '').trim() || null
			});
			await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.mouvement.create', {}, { mouvementId: m.id, compteId: compte.id, montant: m.montant });
		} catch (err) {
			if (err instanceof BanqueError) return fail(400, { ...echo, error: err.message });
			throw err;
		}
		return { section: 'mouvement', success: 'Mouvement enregistré.' };
	},

	update: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const compte = await loadCompte(params);
		const formData = await request.formData();
		const nom = String(formData.get('nom') ?? '').trim();
		const iban = normalizeIban(String(formData.get('iban') ?? ''));
		const soldeOuverture = parseFormMoney(formData.get('soldeOuverture') || '0');
		const dateOuverture = parseFormDate(formData.get('dateOuverture'));
		const echo = { section: 'compte', values: Object.fromEntries(formData) as Record<string, string> };
		if (!nom) return fail(400, { ...echo, error: 'Le nom du compte est obligatoire.' });
		if (iban && !isValidIban(iban)) return fail(400, { ...echo, error: 'IBAN invalide.' });
		if (soldeOuverture === null) return fail(400, { ...echo, error: 'Solde d’ouverture invalide.' });
		if (!dateOuverture) return fail(400, { ...echo, error: 'Date d’ouverture invalide.' });
		await updateCompte(compte.id, {
			type: formData.get('type') === 'caisse' ? 'caisse' : 'banque',
			nom,
			iban: iban || null,
			soldeOuverture,
			dateOuverture,
			actif: !formData.has('inactif')
		});
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.compte.update', {}, { compteId: compte.id });
		return { section: 'compte', success: 'Compte enregistré.' };
	}
};
