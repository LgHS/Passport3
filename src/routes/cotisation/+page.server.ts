import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getMemberByEmail,
	getMemberSubscriptions,
	getMemberTypes,
	deriveCotisationStatus,
	detectCotisationGaps,
	parseDolibarrDate,
	getThirdPartyIbanPro,
	updateMemberIbanPerso,
	updateThirdPartyIbanPro,
	findIbanOwnerConflict
} from '$lib/server/dolibarr';
import { validateBankInfoSubmission, maskIban } from '$lib/server/bankValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

// Auth guard shared by the load and the action below — never trust a client-submitted member/
// thirdparty id, always re-derive from the authenticated session's email.
async function resolveOwnMember(locals: App.Locals) {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const email = locals.user.email;
	if (!email) {
		error(500, 'Impossible de résoudre votre adresse email pour interroger Dolibarr.');
	}

	return getMemberByEmail(email);
}

export const load: PageServerLoad = async ({ locals }) => {
	const member = await resolveOwnMember(locals);
	if (!member) {
		// Not a technical failure — a plausible business state (registration not yet synced to
		// Dolibarr, or a data mismatch) — so the page handles it itself with an explanation
		// instead of bouncing to the generic error page.
		return { status: null, datefin: null, subscriptions: [], gaps: [], isInactive: false, bankInfo: null };
	}

	const [types, subscriptions, ibanPro] = await Promise.all([
		getMemberTypes(),
		getMemberSubscriptions(member.id),
		member.fkSoc ? getThirdPartyIbanPro(member.fkSoc) : Promise.resolve(null)
	]);
	const { gaps, isInactive } = detectCotisationGaps(subscriptions);

	return {
		status: deriveCotisationStatus(member, types),
		datefin: parseDolibarrDate(member.datefin),
		subscriptions,
		gaps,
		isInactive,
		bankInfo: {
			perso: member.ibanPerso,
			// `pro` is only meaningful when the member is linked to a billing third-party — the
			// page only renders both fields at all when isPro is true, regardless of whether an
			// IBAN has actually been entered there yet.
			isPro: member.fkSoc !== null,
			pro: ibanPro
		}
	};
};

export const actions: Actions = {
	updateBankInfo: async ({ request, locals }) => {
		const member = await resolveOwnMember(locals);
		if (!member) {
			error(404, 'Aucun adhérent Dolibarr trouvé pour votre adresse email.');
		}
		const user = locals.user!;
		// Dolibarr's member.id (used everywhere else in this file) and Authentik's pk are two
		// different id spaces — the audit trail is keyed on the latter, same as every other
		// action, so it resolves separately here even though the rest of this action never needs it.
		const pk = authentikPk(user);

		const beforeIbanPro = member.fkSoc ? await getThirdPartyIbanPro(member.fkSoc) : null;

		const formData = await request.formData();
		// The pro IBAN only exists for members linked to a billing third-party — strip it before
		// validation (rather than after) so a non-pro member can never have their legitimate
		// ibanPerso update rejected by a stray/malformed ibanPro that isn't even theirs to set.
		if (!member.fkSoc) {
			formData.delete('ibanPro');
		}

		const result = validateBankInfoSubmission(formData);
		if (!result.ok) {
			return fail(400, { error: result.error, ibanPerso: result.ibanPerso, ibanPro: result.ibanPro });
		}

		// Stop a member from entering someone else's IBAN — a same-person perso/pro match (the
		// "indépendant" case) is fine, anything else isn't.
		const own = { memberId: member.id, fkSoc: member.fkSoc };
		const conflictChecks = [
			result.ibanPerso ? findIbanOwnerConflict(result.ibanPerso, own) : Promise.resolve(false),
			result.ibanPro ? findIbanOwnerConflict(result.ibanPro, own) : Promise.resolve(false)
		];
		if ((await Promise.all(conflictChecks)).some(Boolean)) {
			return fail(400, {
				error: 'Cet IBAN est déjà utilisé.',
				ibanPerso: result.ibanPerso,
				ibanPro: result.ibanPro
			});
		}

		const updates: Promise<void>[] = [updateMemberIbanPerso(member.id, result.ibanPerso)];
		if (member.fkSoc) {
			updates.push(updateThirdPartyIbanPro(member.fkSoc, result.ibanPro));
		}
		await Promise.all(updates);

		// Masked to the last 4 digits — this is the flagship case an audit trail exists for
		// (knowing who changed a payout IBAN, for fraud prevention), but the full number doesn't
		// need to live a second time at rest here just to serve that purpose.
		logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'bankInfo.update',
			pk ? { pk } : { email: user.email },
			{
				before: { ibanPerso: maskIban(member.ibanPerso ?? ''), ibanPro: maskIban(beforeIbanPro ?? '') },
				after: { ibanPerso: maskIban(result.ibanPerso), ibanPro: maskIban(result.ibanPro) }
			}
		);

		return { success: true, ibanPerso: result.ibanPerso, ibanPro: result.ibanPro };
	}
};
