import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getMemberByEmail,
	getMemberSubscriptions,
	getMemberTypes,
	deriveCotisationStatus,
	parseDolibarrDate,
	getThirdPartyIbanPro,
	updateMemberIbanPerso,
	updateThirdPartyIbanPro
} from '$lib/server/dolibarr';
import { validateBankInfoSubmission } from '$lib/server/bankValidation';

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
		return { status: null, datefin: null, subscriptions: [], bankInfo: null };
	}

	const [types, subscriptions, ibanPro] = await Promise.all([
		getMemberTypes(),
		getMemberSubscriptions(member.id),
		member.fkSoc ? getThirdPartyIbanPro(member.fkSoc) : Promise.resolve(null)
	]);

	return {
		status: deriveCotisationStatus(member, types),
		datefin: parseDolibarrDate(member.datefin),
		subscriptions,
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

		const result = validateBankInfoSubmission(await request.formData());
		if (!result.ok) {
			return fail(400, { error: result.error, ibanPerso: result.ibanPerso, ibanPro: result.ibanPro });
		}

		const updates: Promise<void>[] = [updateMemberIbanPerso(member.id, result.ibanPerso)];
		// The pro IBAN only exists on the linked billing third-party — re-derived server-side
		// from the session (never trusted from the client), so a non-pro member submitting an
		// ibanPro value simply has it ignored rather than needing a separate 403.
		if (member.fkSoc) {
			updates.push(updateThirdPartyIbanPro(member.fkSoc, result.ibanPro));
		}
		await Promise.all(updates);

		return { success: true, ibanPerso: result.ibanPerso, ibanPro: result.ibanPro };
	}
};
