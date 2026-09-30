import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import {
	BanqueError,
	creerCotisationLibre,
	delettrer,
	deleteMouvement,
	estImporte,
	getMouvement,
	lettrer,
	listLettrages,
	suggestionsPour,
	updateMouvement,
	type CibleType
} from '$lib/server/compta/banque';
import { addUTCMonths, parseFormDate, parseFormMoney } from '$lib/server/compta/dates';
import { listTiers, tiersDisplayName } from '$lib/server/compta/tiers';
import { definirRubrique, RubriqueError } from '$lib/server/compta/rubriquesDb';
import { parseRubrique } from '$lib/rubriques';
import { isValidIban, normalizeIban } from '$lib/server/bankValidation';
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
		importe: estImporte(mouvement),
		lettrages,
		factures: suggestions.factures.map((f) => ({
			id: f.id,
			numero: f.numero ?? `#${f.id}`,
			tiersNom: f.tiers.nom,
			tiersId: f.tiersId,
			total: f.total,
			type: f.type
		})),
		notes: suggestions.notes.map((n) => ({ id: n.id, tiersNom: n.tiersNom, tiersId: n.tiersId, libelle: n.libelle, montant: n.montant })),
		tiersSuggere: suggestions.tiers ? { id: suggestions.tiers.id, nom: tiersDisplayName(suggestions.tiers), nature: suggestions.tiers.nature } : null,
		personnes: personnes.map((p) => ({ id: p.id, nom: tiersDisplayName(p) }))
	};
};

function parseCible(value: unknown): CibleType | null {
	return value === 'facture' || value === 'cotisation' || value === 'note_de_frais' || value === 'autre' ? value : null;
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

	// The heading of the official statement an allocation falls under. It's stored on the document
	// the allocation points to (or on the allocation itself, for "autre"), so an invoice paid in
	// two movements has one heading.
	rubrique: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const mouvement = await loadMouvement(params);
		const formData = await request.formData();
		const id = Number(formData.get('lettrageId'));
		const lettrage = (await listLettrages(mouvement.id)).find((l) => l.id === id);
		if (!lettrage) error(404, 'Lettrage introuvable.');
		const raw = String(formData.get('rubrique') ?? '');
		// Empty = back to the default.
		const rubrique = raw ? parseRubrique(raw, lettrage.rubriqueSens) : null;
		if (raw && !rubrique) return fail(400, { error: 'Rubrique invalide pour ce document.' });
		try {
			if (lettrage.cibleType === 'autre') await definirRubrique('lettrage', lettrage.id, rubrique);
			else await definirRubrique(lettrage.cibleType, lettrage.cibleId!, rubrique);
		} catch (err) {
			if (err instanceof RubriqueError) return fail(400, { error: err.message });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.rubrique.update', {}, {
			cible: `${lettrage.cibleType}:${lettrage.cibleId ?? lettrage.id}`,
			rubrique
		});
		return { success: 'Rubrique enregistrée.' };
	},

	modifier: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const mouvement = await loadMouvement(params);
		const formData = await request.formData();
		const str = (key: string) => String(formData.get(key) ?? '').trim() || null;
		const importe = estImporte(mouvement);

		const libelle = str('libelle');
		if (!libelle) return fail(400, { error: 'Le libellé est obligatoire.' });
		// The bank's own date and amount aren't submitted for an imported movement.
		const dateValeur = importe ? mouvement.dateValeur : parseFormDate(formData.get('dateValeur'));
		if (!dateValeur) return fail(400, { error: 'Date invalide.' });
		let montant = mouvement.montant;
		if (!importe) {
			const saisi = parseFormMoney(formData.get('montant'));
			if (saisi === null || saisi === 0) return fail(400, { error: 'Montant invalide.' });
			// Typed without sign, like when the movement was entered; the direction is its own field.
			montant = mouvement.transfertId !== null ? saisi : formData.get('sens') === 'sortie' ? -Math.abs(saisi) : Math.abs(saisi);
		}
		const iban = normalizeIban(str('contrepartieIban') ?? '');
		if (iban && !isValidIban(iban)) return fail(400, { error: 'IBAN de la contrepartie invalide.' });

		try {
			await updateMouvement(mouvement.id, {
				dateValeur,
				montant,
				libelle,
				contrepartieNom: str('contrepartieNom'),
				contrepartieIban: iban || null,
				communication: str('communication')
			});
		} catch (err) {
			if (err instanceof BanqueError) return fail(400, { error: err.message });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.mouvement.update', {}, {
			mouvementId: mouvement.id,
			avant: { date: mouvement.dateValeur.toISOString().slice(0, 10), montant: mouvement.montant, libelle: mouvement.libelle },
			apres: { date: dateValeur.toISOString().slice(0, 10), montant, libelle }
		});
		return { success: 'Mouvement corrigé.' };
	},

	supprimer: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const mouvement = await loadMouvement(params);
		try {
			await deleteMouvement(mouvement.id);
		} catch (err) {
			if (err instanceof BanqueError) return fail(400, { error: err.message });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.mouvement.delete', {}, {
			mouvementId: mouvement.id,
			compteId: mouvement.compteId,
			date: mouvement.dateValeur.toISOString().slice(0, 10),
			montant: mouvement.montant,
			libelle: mouvement.libelle,
			importe: estImporte(mouvement),
			virementInterne: mouvement.transfertId !== null
		});
		redirect(303, `/compta/banque/${mouvement.compteId}`);
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
