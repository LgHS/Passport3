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
import { getThirdPartyInvoices, DolibarrUnavailableError, type DolibarrInvoice } from '$lib/server/dolibarr';
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

// Distinct from "no tiers found" below — see feedback_distinguish-fetch-failure-from-empty. A
// member with genuinely no tiers and a member Postgres couldn't serve for both end up with
// `status: null`, but only `unavailable: true` means "we don't know yet, ask again" rather than
// "confirmed: nothing to show here". Postgres outages are reported by handleError for this page,
// so `unavailable` here now only concerns the invoices, still read from Dolibarr (phase 1, see
// docs/compta.md).
const NO_MEMBER_RESULT = {
	unavailable: false,
	status: null,
	datefin: null,
	finGrace: null,
	via: null,
	subscriptions: [],
	gaps: [],
	isInactive: false,
	bankInfo: null,
	invoices: [] as DolibarrInvoice[],
	invoicesUnavailable: false
};

// Phase-1 bridge: invoices are still Dolibarr's until the factures table lands. They hang off
// Dolibarr third parties, which the import kept on each tiers as dolibarr_soc_id — the member's own
// (a person who was invoiced directly) and the organisations they administer.
async function loadDolibarrInvoices(tiers: Tiers, organisations: Tiers[]) {
	const socIds = [tiers, ...organisations].map((t) => t.dolibarrSocId).filter((id): id is number => id !== null);
	try {
		const lists = await Promise.all(socIds.map((id) => getThirdPartyInvoices(id)));
		const invoices = lists.flat().sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
		return { invoices, invoicesUnavailable: false };
	} catch (err) {
		if (err instanceof DolibarrUnavailableError) {
			return { invoices: [] as DolibarrInvoice[], invoicesUnavailable: true };
		}
		throw err;
	}
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
	const { invoices, invoicesUnavailable } = await loadDolibarrInvoices(tiers, organisations);

	return {
		unavailable: false,
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
		invoices,
		invoicesUnavailable
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
