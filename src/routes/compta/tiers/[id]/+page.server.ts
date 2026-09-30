import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import {
	createAbonnement,
	createCotisation,
	deleteAbonnement,
	deleteCotisation,
	getAbonnement,
	getCotisation,
	getSituationForTiers,
	listAbonnements,
	listCotisations,
	SuppressionRefuseeError,
	updateAbonnement,
	updateCotisation,
	type CotisationStatut,
	type CotisationType,
	type Periodicite
} from '$lib/server/compta/cotisations';
import {
	createLien,
	deleteLien,
	getLien,
	listLiensOfOrganisation,
	listLiensOfPersonne,
	siegesOrganisation,
	SiegesEpuisesError,
	updateLien
} from '$lib/server/compta/liens';
import { getTiers, listTiers, tiersDisplayName, updateTiers } from '$lib/server/compta/tiers';
import { tiersInputFromForm } from '$lib/server/compta/tiersForm';
import { brusselsToday, parseFormDate, parseFormMoney } from '$lib/server/compta/dates';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, type AppUser } from '$lib/types';

function tiersId(params: { id: string }): number {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Tiers introuvable.');
	return id;
}

async function loadTiers(params: { id: string }) {
	const tiers = await getTiers(tiersId(params));
	if (!tiers) error(404, 'Tiers introuvable.');
	return tiers;
}

export const load: PageServerLoad = async ({ params }) => {
	const tiers = await loadTiers(params);
	const isOrganisation = tiers.nature === 'personne_morale';

	const [situation, cotisations, liens, abonnements, sieges, candidats] = await Promise.all([
		getSituationForTiers(tiers),
		listCotisations(tiers.id),
		isOrganisation ? listLiensOfOrganisation(tiers.id) : listLiensOfPersonne(tiers.id),
		isOrganisation ? listAbonnements(tiers.id) : Promise.resolve([]),
		isOrganisation ? siegesOrganisation(tiers.id, brusselsToday()) : Promise.resolve(null),
		// The other side a new link can point to: persons for an organisation, organisations for a
		// person. Small lists at this org's scale — a plain <select>.
		listTiers({ nature: isOrganisation ? 'personne_physique' : 'personne_morale', actifOnly: true })
	]);

	return {
		tiers: { ...tiers, displayName: tiersDisplayName(tiers) },
		situation,
		cotisations,
		liens,
		abonnements,
		sieges,
		candidats: candidats.map((c) => ({ id: c.id, nom: tiersDisplayName(c) }))
	};
};

function audit(user: AppUser, action: string, tiersId: number, details: Record<string, unknown>) {
	return logAuditEvent({ sub: user.sub, label: displayName(user) }, 'admin', action, {}, { tiersId, ...details });
}

function parseType(value: unknown): CotisationType | null {
	return value === 'libre' || value === 'facturee' || value === 'sponsoring' ? value : null;
}
function parseStatut(value: unknown): CotisationStatut | null {
	return value === 'attendue' || value === 'active' || value === 'annulee' ? value : null;
}
function parsePeriodicite(value: unknown): Periodicite | null {
	return value === 'mois' || value === 'annee' ? value : null;
}
function parseCount(value: FormDataEntryValue | null, fallback = 1): number | null {
	if (value === null || value === '') return fallback;
	const n = Number(value);
	return Number.isInteger(n) && n >= 0 ? n : null;
}

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const formData = await request.formData();
		const parsed = tiersInputFromForm(formData);
		if (!parsed.ok) {
			return fail(400, { section: 'tiers', error: parsed.error, values: Object.fromEntries(formData) as Record<string, string> });
		}
		await updateTiers(tiers.id, parsed.input);
		await audit(tresorier, 'compta.tiers.update', tiers.id, { nom: parsed.input.nom });
		return { section: 'tiers', success: 'Tiers enregistré.' };
	},

	// Adds a cotisation, or corrects one (cotisationId posted): every field can change. What ties
	// it to an invoice or a subscription stays as it is.
	saveCotisation: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const formData = await request.formData();

		const idRaw = formData.get('cotisationId');
		const existante = idRaw ? await getCotisation(Number(idRaw)) : null;
		// Belongs-to check: the id comes from the form, the tiers from the URL — they must agree.
		if (idRaw && (!existante || existante.tiersId !== tiers.id)) error(404, 'Cotisation introuvable.');

		const type = parseType(formData.get('type'));
		const debut = parseFormDate(formData.get('debut'));
		const fin = parseFormDate(formData.get('fin'));
		const montant = parseFormMoney(formData.get('montant'));
		const sieges = parseCount(formData.get('sieges'));
		const statut = parseStatut(formData.get('statut'));
		const payeLe = formData.get('payeLe') ? parseFormDate(formData.get('payeLe')) : null;
		const note = String(formData.get('note') ?? '').trim() || null;

		if (!type || !statut) return fail(400, { section: 'cotisation', error: 'Type ou statut invalide.' });
		if (!debut || !fin) return fail(400, { section: 'cotisation', error: 'Dates invalides (AAAA-MM-JJ).' });
		// `fin` is the first day NOT covered — the form asks for the last covered day, so +1 here.
		const finExclusive = new Date(fin.getTime() + 86_400_000);
		if (finExclusive.getTime() <= debut.getTime()) {
			return fail(400, { section: 'cotisation', error: 'La fin doit être postérieure ou égale au début.' });
		}
		if (montant === null) return fail(400, { section: 'cotisation', error: 'Montant invalide.' });
		if (sieges === null) return fail(400, { section: 'cotisation', error: 'Nombre de sièges invalide.' });
		if (formData.get('payeLe') && !payeLe) return fail(400, { section: 'cotisation', error: 'Date de paiement invalide.' });

		const input = {
			tiersId: tiers.id,
			type,
			debut,
			fin: finExclusive,
			montant,
			sieges,
			statut,
			abonnementId: existante?.abonnementId ?? null,
			factureId: existante?.factureId ?? null,
			payeLe: statut === 'active' ? (payeLe ?? existante?.payeLe ?? brusselsToday()) : payeLe,
			note
		};
		if (existante) {
			await updateCotisation(existante.id, input);
			await audit(tresorier, 'compta.cotisation.update', tiers.id, {
				cotisationId: existante.id,
				avant: { debut: existante.debut.toISOString().slice(0, 10), fin: existante.fin.toISOString().slice(0, 10), montant: existante.montant, statut: existante.statut, sieges: existante.sieges },
				apres: { debut: debut.toISOString().slice(0, 10), fin: finExclusive.toISOString().slice(0, 10), montant, statut, sieges }
			});
			return { section: 'cotisation', success: 'Cotisation corrigée.' };
		}
		const cotisation = await createCotisation(input);
		await audit(tresorier, 'compta.cotisation.create', tiers.id, { cotisationId: cotisation.id, type, montant });
		return { section: 'cotisation', success: 'Cotisation ajoutée.' };
	},

	deleteCotisation: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const id = Number((await request.formData()).get('cotisationId'));
		const cotisation = Number.isInteger(id) ? await getCotisation(id) : null;
		if (!cotisation || cotisation.tiersId !== tiers.id) error(404, 'Cotisation introuvable.');
		try {
			await deleteCotisation(cotisation.id);
		} catch (err) {
			if (err instanceof SuppressionRefuseeError) return fail(400, { section: 'cotisation', error: err.message });
			throw err;
		}
		await audit(tresorier, 'compta.cotisation.delete', tiers.id, {
			cotisationId: cotisation.id,
			type: cotisation.type,
			debut: cotisation.debut.toISOString().slice(0, 10),
			fin: cotisation.fin.toISOString().slice(0, 10),
			montant: cotisation.montant
		});
		return { section: 'cotisation', success: 'Cotisation supprimée.' };
	},

	// Mark paid (attendue → active) or cancel — the two treasury moves on an existing cotisation.
	setCotisationStatut: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const formData = await request.formData();
		const id = Number(formData.get('cotisationId'));
		const statut = parseStatut(formData.get('statut'));
		const cotisation = Number.isInteger(id) ? await getCotisation(id) : null;
		// Belongs-to check: the id comes from the form, the tiers from the URL — they must agree.
		if (!cotisation || cotisation.tiersId !== tiers.id) error(404, 'Cotisation introuvable.');
		if (!statut) return fail(400, { section: 'cotisation', error: 'Statut invalide.' });

		await updateCotisation(cotisation.id, {
			...cotisation,
			statut,
			payeLe: statut === 'active' ? (cotisation.payeLe ?? brusselsToday()) : cotisation.payeLe
		});
		await audit(tresorier, 'compta.cotisation.statut', tiers.id, { cotisationId: cotisation.id, statut });
		return { section: 'cotisation', success: 'Cotisation mise à jour.' };
	},

	// Creates a link, or corrects one (lienId posted): roles, seat and dates. The two tiers of an
	// existing link don't change — a link to someone else is another link.
	saveLien: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const formData = await request.formData();

		const idRaw = formData.get('lienId');
		const existant = idRaw ? await getLien(Number(idRaw)) : null;
		if (idRaw && (!existant || (existant.organisationId !== tiers.id && existant.personneId !== tiers.id))) error(404, 'Lien introuvable.');

		let organisationId: number;
		let personneId: number;
		if (existant) {
			organisationId = existant.organisationId;
			personneId = existant.personneId;
		} else {
			const autreId = Number(formData.get('autreId'));
			const autre = Number.isInteger(autreId) ? await getTiers(autreId) : null;
			if (!autre || autre.nature === tiers.nature) {
				return fail(400, { section: 'lien', error: 'Choisissez un tiers de l’autre nature.' });
			}
			[organisationId, personneId] = tiers.nature === 'personne_morale' ? [tiers.id, autre.id] : [autre.id, tiers.id];
		}
		const depuis = parseFormDate(formData.get('depuis')) ?? existant?.depuis ?? brusselsToday();
		// The form asks for the last day of the link; `jusqua` is the first day without it.
		const dernierJour = formData.get('jusqua') ? parseFormDate(formData.get('jusqua')) : null;
		if (formData.get('jusqua') && !dernierJour) return fail(400, { section: 'lien', error: 'Date de fin invalide.' });
		const jusqua = dernierJour ? new Date(dernierJour.getTime() + 86_400_000) : null;
		if (jusqua && jusqua.getTime() <= depuis.getTime()) {
			return fail(400, { section: 'lien', error: 'La fin doit être postérieure ou égale au début.' });
		}

		const input = {
			organisationId,
			personneId,
			estEmploye: formData.has('estEmploye'),
			estAdministrateur: formData.has('estAdministrateur'),
			estContact: formData.has('estContact'),
			destinataireFactures: formData.has('destinataireFactures'),
			heriteAdhesion: formData.has('heriteAdhesion'),
			depuis,
			jusqua
		};
		try {
			if (existant) {
				await updateLien(existant.id, input);
				await audit(tresorier, 'compta.lien.update', tiers.id, {
					lienId: existant.id,
					avant: {
						administrateur: existant.estAdministrateur,
						employe: existant.estEmploye,
						contact: existant.estContact,
						destinataireFactures: existant.destinataireFactures,
						heriteAdhesion: existant.heriteAdhesion
					},
					apres: {
						administrateur: input.estAdministrateur,
						employe: input.estEmploye,
						contact: input.estContact,
						destinataireFactures: input.destinataireFactures,
						heriteAdhesion: input.heriteAdhesion
					}
				});
				return { section: 'lien', success: 'Lien corrigé.' };
			}
			const lien = await createLien(input);
			await audit(tresorier, 'compta.lien.create', tiers.id, { lienId: lien.id, organisationId, personneId });
			return { section: 'lien', success: 'Lien créé.' };
		} catch (err) {
			if (err instanceof SiegesEpuisesError) return fail(400, { section: 'lien', error: err.message });
			// UNIQUE (organisation_id, personne_id): the pair already exists — edit that one instead.
			if ((err as { code?: string }).code === '23505') {
				return fail(400, { section: 'lien', error: 'Ce lien existe déjà : corrigez-le plutôt.' });
			}
			throw err;
		}
	},

	deleteLien: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const id = Number((await request.formData()).get('lienId'));
		const lien = Number.isInteger(id) ? await getLien(id) : null;
		if (!lien || (lien.organisationId !== tiers.id && lien.personneId !== tiers.id)) error(404, 'Lien introuvable.');
		await deleteLien(lien.id);
		await audit(tresorier, 'compta.lien.delete', tiers.id, { lienId: lien.id, organisationId: lien.organisationId, personneId: lien.personneId });
		return { section: 'lien', success: 'Lien supprimé.' };
	},

	// Closing dates a link's end rather than deleting it (history stays); reopening clears it.
	closeLien: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const formData = await request.formData();
		const id = Number(formData.get('lienId'));
		const lien = Number.isInteger(id) ? await getLien(id) : null;
		if (!lien || (lien.organisationId !== tiers.id && lien.personneId !== tiers.id)) error(404, 'Lien introuvable.');

		const reopen = formData.has('reopen');
		const jusqua = reopen ? null : brusselsToday();
		if (jusqua && jusqua.getTime() <= lien.depuis.getTime()) {
			return fail(400, { section: 'lien', error: 'Un lien ouvert aujourd’hui ne peut pas être clos aujourd’hui.' });
		}
		try {
			await updateLien(lien.id, { ...lien, jusqua });
		} catch (err) {
			if (err instanceof SiegesEpuisesError) return fail(400, { section: 'lien', error: err.message });
			throw err;
		}
		await audit(tresorier, reopen ? 'compta.lien.reopen' : 'compta.lien.close', tiers.id, { lienId: lien.id });
		return { section: 'lien', success: reopen ? 'Lien réouvert.' : 'Lien clos.' };
	},

	saveAbonnement: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		if (tiers.nature !== 'personne_morale') error(400, 'Seule une société a un abonnement.');
		const formData = await request.formData();

		const idRaw = formData.get('abonnementId');
		const existant = idRaw ? await getAbonnement(Number(idRaw)) : null;
		if (idRaw && (!existant || existant.tiersId !== tiers.id)) error(404, 'Abonnement introuvable.');

		const libelle = String(formData.get('libelle') ?? '').trim();
		const prix = parseFormMoney(formData.get('prix'));
		const periodicite = parsePeriodicite(formData.get('periodicite'));
		const sieges = parseCount(formData.get('sieges'));
		const prochaineEcheance = parseFormDate(formData.get('prochaineEcheance'));

		if (!libelle) return fail(400, { section: 'abonnement', error: 'Le libellé est obligatoire.' });
		if (prix === null) return fail(400, { section: 'abonnement', error: 'Prix invalide.' });
		if (!periodicite) return fail(400, { section: 'abonnement', error: 'Périodicité invalide.' });
		if (sieges === null) return fail(400, { section: 'abonnement', error: 'Nombre de sièges invalide.' });
		if (!prochaineEcheance) return fail(400, { section: 'abonnement', error: 'Prochaine échéance invalide.' });

		const input = { tiersId: tiers.id, libelle, prix, periodicite, sieges, prochaineEcheance, actif: existant?.actif ?? true };
		if (existant) {
			await updateAbonnement(existant.id, input);
			await audit(tresorier, 'compta.abonnement.update', tiers.id, {
				abonnementId: existant.id,
				avant: { prix: existant.prix, periodicite: existant.periodicite, sieges: existant.sieges, prochaineEcheance: existant.prochaineEcheance.toISOString().slice(0, 10) },
				apres: { prix, periodicite, sieges, prochaineEcheance: prochaineEcheance.toISOString().slice(0, 10) }
			});
			return { section: 'abonnement', success: 'Abonnement corrigé.' };
		}
		const abonnement = await createAbonnement(input);
		await audit(tresorier, 'compta.abonnement.create', tiers.id, { abonnementId: abonnement.id, prix, periodicite, sieges });
		return { section: 'abonnement', success: 'Abonnement créé.' };
	},

	deleteAbonnement: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const id = Number((await request.formData()).get('abonnementId'));
		const abonnement = Number.isInteger(id) ? await getAbonnement(id) : null;
		if (!abonnement || abonnement.tiersId !== tiers.id) error(404, 'Abonnement introuvable.');
		try {
			await deleteAbonnement(abonnement.id);
		} catch (err) {
			if (err instanceof SuppressionRefuseeError) return fail(400, { section: 'abonnement', error: err.message });
			throw err;
		}
		await audit(tresorier, 'compta.abonnement.delete', tiers.id, { abonnementId: abonnement.id, libelle: abonnement.libelle });
		return { section: 'abonnement', success: 'Abonnement supprimé.' };
	},

	toggleAbonnement: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const tiers = await loadTiers(params);
		const formData = await request.formData();
		const id = Number(formData.get('abonnementId'));
		const abonnement = Number.isInteger(id) ? await getAbonnement(id) : null;
		if (!abonnement || abonnement.tiersId !== tiers.id) error(404, 'Abonnement introuvable.');

		await updateAbonnement(abonnement.id, { ...abonnement, actif: !abonnement.actif });
		await audit(tresorier, 'compta.abonnement.toggle', tiers.id, { abonnementId: abonnement.id, actif: !abonnement.actif });
		return { section: 'abonnement', success: abonnement.actif ? 'Abonnement suspendu.' : 'Abonnement réactivé.' };
	}
};
