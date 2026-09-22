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
	findIbanOwnerConflict,
	DolibarrUnavailableError
} from '$lib/server/dolibarr';

const DOLIBARR_UNAVAILABLE_MESSAGE = 'Service temporairement indisponible. Réessayez dans quelques instants.';
import { validateBankInfoSubmission, normalizeIban } from '$lib/server/bankValidation';

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

// Distinct from "no Dolibarr member found" below — see feedback_distinguish-fetch-failure-from-empty.
// A member with genuinely no Dolibarr record and a member Dolibarr couldn't be reached for both
// end up with `status: null`, but only `unavailable: true` means "we don't know yet, ask again"
// rather than "confirmed: nothing to show here".
const NO_MEMBER_RESULT = {
	unavailable: false,
	status: null,
	datefin: null,
	subscriptions: [],
	gaps: [],
	isInactive: false,
	bankInfo: null
};

export const load: PageServerLoad = async ({ locals }) => {
	try {
		const member = await resolveOwnMember(locals);
		if (!member) {
			// Not a technical failure — a plausible business state (registration not yet synced to
			// Dolibarr, or a data mismatch) — so the page handles it itself with an explanation
			// instead of bouncing to the generic error page.
			return NO_MEMBER_RESULT;
		}

		const [types, subscriptions, ibanPro] = await Promise.all([
			getMemberTypes(),
			getMemberSubscriptions(member.id),
			member.fkSoc ? getThirdPartyIbanPro(member.fkSoc) : Promise.resolve(null)
		]);
		const { gaps, isInactive } = detectCotisationGaps(subscriptions);

		return {
			unavailable: false,
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
	} catch (err) {
		if (err instanceof DolibarrUnavailableError) {
			return { ...NO_MEMBER_RESULT, unavailable: true };
		}
		throw err;
	}
};

export const actions: Actions = {
	updateBankInfo: async ({ request, locals }) => {
		try {
			const member = await resolveOwnMember(locals);
			if (!member) {
				error(404, 'Aucun adhérent Dolibarr trouvé pour votre adresse email.');
			}

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

			// Canonicalized before comparing: `member.ibanPerso`/`currentIbanPro` come straight from
			// Dolibarr (`string | null`, and not guaranteed to be stored in the same normalized form
			// validateBankInfoSubmission() already put `result.*` through), while an empty submitted
			// field is `''` rather than `null`. Comparing the raw values would treat "no IBAN on
			// either side" as a change (`'' !== null`), and a same IBAN stored with different
			// spacing as a false difference — both would defeat the point of only touching what
			// actually changed.
			const currentIbanPro = member.fkSoc ? await getThirdPartyIbanPro(member.fkSoc) : null;
			const storedIbanPerso = normalizeIban(member.ibanPerso ?? '');
			const storedIbanPro = normalizeIban(currentIbanPro ?? '');
			const ibanPersoChanged = result.ibanPerso !== storedIbanPerso;
			const ibanProChanged = member.fkSoc !== null && result.ibanPro !== storedIbanPro;

			// Stop a member from entering someone else's IBAN — a same-person perso/pro match (the
			// "indépendant" case) is fine, anything else isn't (findIbanOwnerConflict excludes the
			// caller's own member id/third-party id for exactly that reason, regardless of which
			// field is being checked). Only checked for values that actually changed: an unchanged
			// value was already vetted when it was originally set, so re-checking it here would
			// only add two full-table Dolibarr scans per field for nothing, and could wrongly block
			// an edit to the *other* field over a pre-existing, untouched value.
			const own = { memberId: member.id, fkSoc: member.fkSoc };
			const conflictChecks = [
				ibanPersoChanged && result.ibanPerso
					? findIbanOwnerConflict(result.ibanPerso, own)
					: Promise.resolve(false),
				ibanProChanged && result.ibanPro
					? findIbanOwnerConflict(result.ibanPro, own)
					: Promise.resolve(false)
			];
			if ((await Promise.all(conflictChecks)).some(Boolean)) {
				return fail(400, {
					error: 'Cet IBAN est déjà utilisé.',
					ibanPerso: result.ibanPerso,
					ibanPro: result.ibanPro
				});
			}

			// One write at a time rather than in parallel — if the second one fails, we then know
			// precisely which one landed instead of a bare "something went wrong" while part of the
			// change may have already gone through.
			if (ibanPersoChanged) {
				try {
					await updateMemberIbanPerso(member.id, result.ibanPerso);
				} catch (err) {
					if (err instanceof DolibarrUnavailableError) throw err;
					return fail(500, {
						error: "La mise à jour de l'IBAN personnel a échoué, réessayez.",
						ibanPerso: result.ibanPerso,
						ibanPro: result.ibanPro
					});
				}
			}
			if (ibanProChanged) {
				try {
					await updateThirdPartyIbanPro(member.fkSoc as number, result.ibanPro);
				} catch (err) {
					// A genuine Dolibarr outage still reads as "temporarily unavailable" overall
					// (the outer catch below) — this only refines the message for a real,
					// non-outage failure on this second write specifically.
					if (err instanceof DolibarrUnavailableError) throw err;
					return fail(500, {
						error: ibanPersoChanged
							? "L'IBAN personnel a été enregistré, mais l'IBAN professionnel n'a pas pu être mis à jour. Réessayez avec l'IBAN professionnel."
							: "La mise à jour de l'IBAN professionnel a échoué, réessayez.",
						ibanPerso: result.ibanPerso,
						ibanPro: result.ibanPro
					});
				}
			}

			return { success: true, ibanPerso: result.ibanPerso, ibanPro: result.ibanPro };
		} catch (err) {
			if (err instanceof DolibarrUnavailableError) {
				return fail(503, { error: DOLIBARR_UNAVAILABLE_MESSAGE });
			}
			throw err;
		}
	}
};
