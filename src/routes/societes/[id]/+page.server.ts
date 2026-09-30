import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSituationForTiers } from '$lib/server/compta/cotisations';
import { listFactures } from '$lib/server/compta/factures';
import { lienEnCours, listLiensOfOrganisation, siegesOrganisation } from '$lib/server/compta/liens';
import {
	findIbanOwnerConflict,
	getTiers,
	listOrganisationsAdministrees,
	resolveTiersForUser,
	tiersDisplayName,
	updateTiersIban,
	type Tiers
} from '$lib/server/compta/tiers';
import { brusselsToday } from '$lib/server/compta/dates';
import { isValidIban, maskIban, normalizeIban } from '$lib/server/bankValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

// An organisation as seen by one of its administrators (tiers_liens.est_administrateur, link
// open today): its membership status and seats, who's linked, its invoices, and its IBAN —
// which lives on the organisation, not on any person's card (docs/compta.md, "Tiers").
//
// The guard re-derives everything from the session: the URL id is only honoured if it's one of
// the organisations the caller administers, otherwise a plain 404 — same as "doesn't exist".
async function resolveOrganisation(locals: App.Locals, params: { id: string }): Promise<{ personne: Tiers; organisation: Tiers }> {
	if (!locals.user) redirect(302, '/login');
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Société introuvable.');
	const personne = await resolveTiersForUser(locals.user);
	if (!personne) error(404, 'Société introuvable.');
	const organisation = (await listOrganisationsAdministrees(personne.id)).find((o) => o.id === id);
	if (!organisation) error(404, 'Société introuvable.');
	return { personne, organisation };
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const { organisation } = await resolveOrganisation(locals, params);
	const today = brusselsToday();
	const [situation, liens, sieges, factures] = await Promise.all([
		getSituationForTiers(organisation),
		listLiensOfOrganisation(organisation.id),
		siegesOrganisation(organisation.id, today),
		listFactures({ sens: 'emise', tiersIds: [organisation.id] })
	]);
	return {
		organisation: {
			id: organisation.id,
			nom: tiersDisplayName(organisation),
			numeroEntreprise: organisation.numeroEntreprise,
			adresse: [organisation.adresse, [organisation.codePostal, organisation.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
			email: organisation.email,
			iban: organisation.iban
		},
		situation: {
			status: situation.status,
			datefin: situation.datefin,
			finGrace: situation.finGrace,
			isInactive: situation.isInactive,
			subscriptions: situation.subscriptions
		},
		sieges,
		// Only open links: a person who left isn't the organisation's business to see here.
		personnes: liens
			.filter((l) => lienEnCours(l, today))
			.map((l) => ({
				id: l.personne.id,
				nom: tiersDisplayName(l.personne),
				email: l.personne.email,
				roles: [l.estAdministrateur && 'administrateur', l.estEmploye && 'employé·e', l.estContact && 'contact', l.destinataireFactures && 'reçoit les factures'].filter(Boolean) as string[],
				membre: l.heriteAdhesion
			})),
		invoices: factures
			.filter((f) => f.statut !== 'brouillon')
			.map((f) => ({
				id: f.id,
				ref: f.numero ?? f.referenceExterne ?? `#${f.id}`,
				date: f.dateEmission,
				amount: f.total,
				paid: f.statut === 'payee',
				abandoned: f.statut === 'annulee',
				type: f.type === 'note_de_credit' ? 'Note de crédit' : 'Facture',
				downloadable: f.hasPdf && f.statut !== 'annulee'
			}))
	};
};

export const actions: Actions = {
	updateIban: async ({ request, locals, params }) => {
		const { personne, organisation } = await resolveOrganisation(locals, params);
		const user = locals.user!;
		const formData = await request.formData();
		const iban = normalizeIban(String(formData.get('iban') ?? ''));
		if (iban && !isValidIban(iban)) return fail(400, { error: 'IBAN invalide (vérifiez le numéro).', iban });
		if (iban === normalizeIban(organisation.iban ?? '')) return fail(400, { error: 'Aucun changement.', iban });
		// The administrator's own person and the organisation share legitimately (indépendant);
		// anyone else's IBAN is refused, as on /cotisation.
		if (iban && (await findIbanOwnerConflict(iban, [organisation.id, personne.id]))) {
			return fail(400, { error: 'Cet IBAN est déjà utilisé.', iban });
		}
		await updateTiersIban(organisation.id, iban);
		const pk = authentikPk(user);
		await logAuditEvent({ sub: user.sub, label: displayName(user) }, 'user', 'societe.iban.update', pk ? { pk } : { email: user.email }, {
			organisationId: organisation.id,
			organisation: tiersDisplayName(organisation),
			before: maskIban(organisation.iban ?? ''),
			after: maskIban(iban)
		});
		return { success: true, iban };
	}
};
