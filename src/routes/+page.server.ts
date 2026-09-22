import type { PageServerLoad } from './$types';
import {
	listUserApplications,
	listMfaDevices,
	getEmergencyContacts,
	type UserApplication
} from '$lib/server/authentikAdmin';
import {
	getMemberByEmail,
	getMemberTypes,
	getMemberSubscriptions,
	getThirdPartyIbanPro,
	deriveCotisationStatus,
	detectCotisationGaps,
	parseDolibarrDate
} from '$lib/server/dolibarr';
import { authentikPk, type CotisationStatus } from '$lib/types';

export interface AppGroup {
	name: string;
	apps: UserApplication[];
}

export interface CotisationSummary {
	status: CotisationStatus | null;
	datefin: Date | null;
	isInactive: boolean;
}

export interface DashboardChecklist {
	// null means "couldn't check" (e.g. a transient Authentik hiccup) — must stay distinguishable
	// from a confirmed false, or a fetch failure would wrongly tell a member to go fix something
	// that's actually already fine.
	mfaConfigured: boolean | null;
	emergencyContactConfigured: boolean | null;
	ibanPersoConfigured: boolean;
	// Only meaningful (and only ever rendered) when ibanProApplicable is true — a classic member
	// has no separate pro IBAN to fill in, see /cotisation's own ibanPersoTooltip for the same
	// perso/pro distinction.
	ibanProApplicable: boolean;
	ibanProConfigured: boolean;
}

const UNGROUPED_LABEL = 'Autres';

function groupApps(apps: UserApplication[]): AppGroup[] {
	const byGroup = new Map<string, UserApplication[]>();
	for (const app of apps) {
		const key = app.group ?? UNGROUPED_LABEL;
		if (!byGroup.has(key)) byGroup.set(key, []);
		byGroup.get(key)?.push(app);
	}

	return [...byGroup.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, apps]) => ({ name, apps }));
}

interface MemberFinancialSummary {
	cotisation: CotisationSummary;
	ibanPerso: string | null;
	isPro: boolean;
	ibanPro: string | null;
}

const NO_FINANCIAL_SUMMARY: MemberFinancialSummary = {
	cotisation: { status: null, datefin: null, isInactive: false },
	ibanPerso: null,
	isPro: false,
	ibanPro: null
};

// Same shape/logic as /cotisation's own load — this is meant to be the exact same status block
// and IBAN checks, just surfaced a click earlier on the homepage. One getMemberByEmail lookup
// shared between the cotisation status and the IBAN fields, rather than fetching the member twice.
async function loadMemberFinancialSummary(email: string | undefined): Promise<MemberFinancialSummary> {
	if (!email) return NO_FINANCIAL_SUMMARY;

	const member = await getMemberByEmail(email);
	if (!member) return NO_FINANCIAL_SUMMARY;

	const [types, subscriptions, ibanPro] = await Promise.all([
		getMemberTypes(),
		getMemberSubscriptions(member.id),
		member.fkSoc ? getThirdPartyIbanPro(member.fkSoc) : Promise.resolve(null)
	]);
	const { isInactive } = detectCotisationGaps(subscriptions);

	return {
		cotisation: {
			status: deriveCotisationStatus(member, types),
			datefin: parseDolibarrDate(member.datefin),
			isInactive
		},
		ibanPerso: member.ibanPerso,
		isPro: member.fkSoc !== null,
		ibanPro
	};
}

const NO_COTISATION: CotisationSummary = { status: null, datefin: null, isInactive: false };
const NO_CHECKLIST: DashboardChecklist = {
	mfaConfigured: null,
	emergencyContactConfigured: null,
	ibanPersoConfigured: false,
	ibanProApplicable: false,
	ibanProConfigured: false
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { groups: null, cotisation: NO_COTISATION, checklist: NO_CHECKLIST };
	}

	const pk = authentikPk(locals.user);

	const [apps, financial, mfaDevices, emergencyContacts] = await Promise.all([
		// Best-effort: a transient Authentik API hiccup shouldn't take down the whole homepage.
		pk ? listUserApplications(pk).catch((): UserApplication[] | null => null) : Promise.resolve(null),
		loadMemberFinancialSummary(locals.user.email),
		pk ? listMfaDevices(pk).catch(() => null) : Promise.resolve(null),
		pk ? getEmergencyContacts(pk).catch(() => null) : Promise.resolve(null)
	]);

	const checklist: DashboardChecklist = {
		mfaConfigured: mfaDevices === null ? null : mfaDevices.length > 0,
		emergencyContactConfigured: emergencyContacts === null ? null : emergencyContacts.length > 0,
		ibanPersoConfigured: !!financial.ibanPerso,
		ibanProApplicable: financial.isPro,
		ibanProConfigured: !!financial.ibanPro
	};

	return { groups: apps ? groupApps(apps) : null, cotisation: financial.cotisation, checklist };
};
