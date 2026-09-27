import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSituationForTiers } from '$lib/server/compta/cotisations';
import {
	findIbanOwnerConflict,
	listOrganisationsAdministrees,
	resolveTiersForUser,
	tiersDisplayName,
	updateTiersIban,
	type Tiers
} from '$lib/server/compta/tiers';
import { listFactures, type Facture } from '$lib/server/compta/factures';
import { isValidIban, maskIban, normalizeIban } from '$lib/server/bankValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

// Auth guard shared by the load and the action below — never trust a client-submitted tiers id,
// always re-derive from the authenticated session.
async function resolveOwnTiers(locals: App.Locals): Promise<Tiers | null> {
	if (!locals.user) {
		redirect(302, '/login');
	}
	return resolveTiersForUser(locals.user);
}

// The organisations shown in the IBAN form: id and name for the field, current IBAN as its value.
function bankOrganisation(t: Tiers) {
	return { id: t.id, nom: tiersDisplayName(t), iban: t.iban };
}

// "No tiers found" is a plausible business state (not yet registered in the books), rendered by
// the page as "compte introuvable"; a Postgres outage, by contrast, throws and is reported by
// handleError — so this page no longer needs an `unavailable` flag of its own.
const NO_MEMBER_RESULT = {
	status: null,
	datefin: null,
	finGrace: null,
	via: null,
	subscriptions: [],
	gaps: [],
	isInactive: false,
	bankInfo: null,
	invoices: [] as MemberInvoice[]
};

// What the page renders per invoice — no storage path, nothing internal.
export interface MemberInvoice {
	id: number;
	ref: string;
	date: Date | null;
	amount: number;
	paid: boolean;
	abandoned: boolean;
	type: string;
	downloadable: boolean;
}

// The member's own invoices and those of the organisations they administer. Drafts are never
// shown: their amount can still change and they have no PDF yet.
async function loadInvoices(tiers: Tiers, organisations: Tiers[]): Promise<MemberInvoice[]> {
	const factures = await listFactures({ sens: 'emise', tiersIds: [tiers, ...organisations].map((t) => t.id) });
	return factures
		.filter((f) => f.statut !== 'brouillon')
		.map((f: Facture) => ({
			id: f.id,
			ref: f.numero ?? f.referenceExterne ?? `#${f.id}`,
			date: f.dateEmission,
			amount: f.total,
			paid: f.statut === 'payee',
			abandoned: f.statut === 'annulee',
			type: f.type === 'note_de_credit' ? 'Note de crédit' : 'Facture',
			downloadable: f.hasPdf && f.statut !== 'annulee'
		}));
}

export const load: PageServerLoad = async ({ locals }) => {
	const tiers = await resolveOwnTiers(locals);
	if (!tiers) {
		// Not a technical failure — a plausible business state (not yet registered in the books,
		// or an email mismatch) — so the page handles it itself with an explanation instead of
		// bouncing to the generic error page.
		return NO_MEMBER_RESULT;
	}

	const [situation, organisations] = await Promise.all([
		getSituationForTiers(tiers),
		listOrganisationsAdministrees(tiers.id)
	]);
	const invoices = await loadInvoices(tiers, organisations);

	return {
		status: situation.status,
		datefin: situation.datefin,
		finGrace: situation.finGrace,
		via: situation.via,
		subscriptions: situation.subscriptions,
		gaps: situation.gaps,
		isInactive: situation.isInactive,
		bankInfo: {
			perso: tiers.iban,
			// One IBAN per organisation the member administers — the page renders one field each,
			// and none of this section when the list is empty (a "classic" member).
			organisations: organisations.map(bankOrganisation)
		},
		invoices
	};
};

// Field name for an organisation's IBAN input — shared with the page through the form data only.
function organisationField(id: number): string {
	return `ibanOrg-${id}`;
}

export const actions: Actions = {
	updateBankInfo: async ({ request, locals }) => {
		const tiers = await resolveOwnTiers(locals);
		if (!tiers) {
			error(404, 'Aucun tiers trouvé pour votre compte.');
		}
		const user = locals.user!;
		const pk = authentikPk(user);
		const organisations = await listOrganisationsAdministrees(tiers.id);

		const formData = await request.formData();
		const ibanPerso = normalizeIban(String(formData.get('ibanPerso') ?? ''));
		// Only the organisations this member administers *now* are read from the form — a stray
		// field for any other id is ignored, never written.
		const ibanOrganisations: Record<number, string> = {};
		for (const org of organisations) {
			ibanOrganisations[org.id] = normalizeIban(String(formData.get(organisationField(org.id)) ?? ''));
		}
		const echo = { ibanPerso, ibanOrganisations };

		// Empty is a valid submission — it means "clear this IBAN" — but anything non-empty has to
		// be a real, checksum-valid IBAN before it's written into the books.
		if (ibanPerso && !isValidIban(ibanPerso)) {
			return fail(400, { error: 'IBAN personnel invalide (vérifiez le numéro).', ...echo });
		}
		for (const org of organisations) {
			const iban = ibanOrganisations[org.id];
			if (iban && !isValidIban(iban)) {
				return fail(400, { error: `IBAN de ${tiersDisplayName(org)} invalide (vérifiez le numéro).`, ...echo });
			}
		}

		// Only what actually changed gets checked and written. Canonicalised on both sides: the
		// stored value may be null, the submitted one is '' for "none".
		const changes: { tiers: Tiers; label: string; before: string; after: string }[] = [];
		if (ibanPerso !== normalizeIban(tiers.iban ?? '')) {
			changes.push({ tiers, label: 'perso', before: tiers.iban ?? '', after: ibanPerso });
		}
		for (const org of organisations) {
			const after = ibanOrganisations[org.id];
			if (after !== normalizeIban(org.iban ?? '')) {
				changes.push({ tiers: org, label: tiersDisplayName(org), before: org.iban ?? '', after });
			}
		}

		// Stop a member from entering someone else's IBAN. Their own tiers and the organisations
		// they administer are excluded — a person and their one-person company legitimately share
		// one (the "indépendant" case). Only checked for values that changed: an unchanged value
		// was vetted when it was set.
		const ownIds = [tiers.id, ...organisations.map((o) => o.id)];
		for (const change of changes) {
			if (change.after && (await findIbanOwnerConflict(change.after, ownIds))) {
				return fail(400, { error: 'Cet IBAN est déjà utilisé.', ...echo });
			}
		}

		for (const change of changes) {
			await updateTiersIban(change.tiers.id, change.after);
		}

		if (changes.length > 0) {
			// Masked to the last 4 digits — this is the flagship case an audit trail exists for
			// (knowing who changed a payout IBAN, for fraud prevention), but the full number doesn't
			// need to live a second time at rest here just to serve that purpose.
			await logAuditEvent(
				{ sub: user.sub, label: displayName(user) },
				'user',
				'bankInfo.update',
				pk ? { pk } : { email: user.email },
				{
					changes: changes.map((c) => ({ tiers: c.label, before: maskIban(c.before), after: maskIban(c.after) }))
				}
			);
		}

		return { success: true, ...echo };
	}
};
