import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import {
	BanqueError,
	creerCotisationLibre,
	delettrer,
	getMouvement,
	lettrer,
	listLettrages,
	suggestionsPour,
	type CibleType
} from '$lib/server/compta/banque';
import { addUTCMonths, parseFormDate, parseFormMoney } from '$lib/server/compta/dates';
import { listTiers, tiersDisplayName } from '$lib/server/compta/tiers';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

async function loadMouvement(params: { id: string }) {
	const id = Number(params.id);
	const mouvement = Number.isInteger(id) && id > 0 ? await getMouvement(id) : null;
	if (!mouvement) error(404, 'Mouvement introuvable.');
	return mouvement;
}

export const load: PageServerLoad = async ({ params }) => {
	const mouvement = await loadMouvement(params);
	const [lettrages, suggestions, personnes] = await Promise.all([
		listLettrages(mouvement.id),
		suggestionsPour(mouvement),
		// For "créer une cotisation libre": the person who paid.
		mouvement.montant > 0 ? listTiers({ nature: 'personne_physique', actifOnly: true }) : Promise.resolve([])
	]);
	return {
		mouvement,
		lettrages,
		factures: suggestions.factures.map((f) => ({
			id: f.id,
			numero: f.numero ?? `#${f.id}`,
			tiersNom: f.tiers.nom,
			tiersId: f.tiersId,
			total: f.total,
			type: f.type
		})),
		tiersSuggere: suggestions.tiers ? { id: suggestions.tiers.id, nom: tiersDisplayName(suggestions.tiers), nature: suggestions.tiers.nature } : null,
		personnes: personnes.map((p) => ({ id: p.id, nom: tiersDisplayName(p) }))
	};
};

function parseCible(value: unknown): CibleType | null {
	return value === 'facture' || value === 'cotisation' || value === 'autre' ? value : null;
}

export const actions: Actions = {
	lettrer: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const mouvement = await loadMouvement(params);
		const formData = await request.formData();
		const type = parseCible(formData.get('cibleType'));
		const cibleId = formData.get('cibleId') ? Number(formData.get('cibleId')) : null;
		const montant = parseFormMoney(formData.get('montant') || String(mouvement.reste));
		const libelle = String(formData.get('libelle') ?? '').trim() || null;
		if (!type) return fail(400, { error: 'Cible invalide.' });
		if (type !== 'autre' && (!cibleId || !Number.isInteger(cibleId))) return fail(400, { error: 'Choisissez une cible.' });
		if (type === 'autre' && !libelle) return fail(400, { error: 'Indiquez à quoi correspond ce mouvement.' });
		if (montant === null) return fail(400, { error: 'Montant invalide.' });
		try {
			const l = await lettrer(mouvement.id, { type, id: type === 'autre' ? null : cibleId, libelle }, montant);
			await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.lettrage.create', {}, {
				mouvementId: mouvement.id,
				lettrageId: l.id,
				cible: `${type}:${cibleId ?? libelle}`,
				montant
			});
		} catch (err) {
			if (err instanceof BanqueError) return fail(400, { error: err.message });
			throw err;
		}
		return { success: 'Lettrage enregistré.' };
	},

	delettrer: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const mouvement = await loadMouvement(params);
		const formData = await request.formData();
		const id = Number(formData.get('lettrageId'));
		const lettrages = await listLettrages(mouvement.id);
		// Belongs-to check: the id comes from the form, the movement from the URL.
		if (!lettrages.some((l) => l.id === id)) error(404, 'Lettrage introuvable.');
		await delettrer(id);
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.lettrage.delete', {}, { mouvementId: mouvement.id, lettrageId: id });
		return { success: 'Lettrage retiré.' };
	},

	cotisationLibre: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const mouvement = await loadMouvement(params);
		const formData = await request.formData();
		const tiersId = Number(formData.get('tiersId'));
		const debut = parseFormDate(formData.get('debut'));
		const duree = formData.get('duree') === 'annee' ? 12 : 1;
		const note = String(formData.get('note') ?? '').trim() || null;
		if (!Number.isInteger(tiersId) || tiersId <= 0) return fail(400, { error: 'Choisissez la personne.' });
		if (!debut) return fail(400, { error: 'Date de début invalide.' });
		try {
			await creerCotisationLibre(mouvement.id, { tiersId, debut, fin: addUTCMonths(debut, duree), note });
			await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.cotisation.libre', {}, {
				mouvementId: mouvement.id,
				tiersId,
				debut: debut.toISOString().slice(0, 10),
				mois: duree
			});
		} catch (err) {
			if (err instanceof BanqueError) return fail(400, { error: err.message });
			throw err;
		}
		return { success: 'Cotisation créée et lettrée.' };
	}
};
