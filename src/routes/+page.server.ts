import type { PageServerLoad } from './$types';
import {
	listUserApplications,
	listMfaDevices,
	getEmergencyContacts,
	getRfidUid,
	type UserApplication
} from '$lib/server/authentikAdmin';
import { getSituationForTiers } from '$lib/server/compta/cotisations';
import { listOrganisationsAdministrees, resolveTiersForUser } from '$lib/server/compta/tiers';
import { isDatabaseUnavailable } from '$lib/server/db';
import { authentikPk, type AppUser, type CotisationStatus } from '$lib/types';
import { hasUploadedAvatar } from '$lib/server/avatars';
import { listOpenTasksForMember } from '$lib/server/tasks';
import { lookupMattermostUsername } from '$lib/server/mattermost';
import { env } from '$env/dynamic/private';

export interface AppGroup {
	name: string;
	apps: UserApplication[];
}

export interface CotisationSummary {
	status: CotisationStatus | null;
	datefin: Date | null;
	finGrace: Date | null;
	isInactive: boolean;
}

export interface DashboardChecklist {
	// null means "couldn't check" (e.g. a transient Authentik hiccup) — must stay distinguishable
	// from a confirmed false, or a fetch failure would wrongly tell a member to go fix something
	// that's actually already fine.
	mfaConfigured: boolean | null;
	emergencyContactConfigured: boolean | null;
	badgeConfigured: boolean | null;
	// A local file check (see avatars.ts), so never "couldn't check" — a plain boolean.
	avatarUploaded: boolean;
	// An active Mattermost account under the member's email (the directory only keeps active
	// ones). null when Mattermost couldn't be asked, same reasoning as above.
	mattermostActivated: boolean | null;
	// Also null when the database is unavailable, same reasoning as above — an outage must never
	// be reported as "IBAN not filled in", which would be actively wrong for a member who already
	// filled it in.
	ibanPersoConfigured: boolean | null;
	// Only meaningful (and only ever rendered) when ibanProApplicable is true — a member who
	// administers no organisation has no company IBAN to fill in, see /cotisation's own
	// ibanPersoTooltip for the same perso/pro distinction.
	ibanProApplicable: boolean;
	ibanProConfigured: boolean | null;
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
	// The member administers at least one organisation (see listOrganisationsAdministrees).
	isPro: boolean;
	// Every administered organisation has an IBAN.
	ibanProConfigured: boolean;
	// Distinct from "no tiers found" (see feedback_distinguish-fetch-failure-from-empty) — a member
	// with no tiers at all and a member whose tiers Postgres couldn't serve both end up with
	// `status: null` above, but only this flag means "we don't actually know, ask again later" as
	// opposed to "confirmed: nothing to show here".
	unavailable: boolean;
}

const NO_FINANCIAL_SUMMARY: MemberFinancialSummary = {
	cotisation: { status: null, datefin: null, finGrace: null, isInactive: false },
	ibanPerso: null,
	isPro: false,
	ibanProConfigured: false,
	unavailable: false
};

const UNAVAILABLE_FINANCIAL_SUMMARY: MemberFinancialSummary = { ...NO_FINANCIAL_SUMMARY, unavailable: true };

// Same shape/logic as /cotisation's own load — this is meant to be the exact same status block
// and IBAN checks, just surfaced a click earlier on the homepage. One tiers lookup shared between
// the cotisation status and the IBAN fields, rather than resolving the member twice.
async function loadMemberFinancialSummary(user: AppUser): Promise<MemberFinancialSummary> {
	try {
		const tiers = await resolveTiersForUser(user);
		if (!tiers) return NO_FINANCIAL_SUMMARY;

		const [situation, organisations] = await Promise.all([
			getSituationForTiers(tiers),
			listOrganisationsAdministrees(tiers.id)
		]);

		return {
			cotisation: {
				status: situation.status,
				datefin: situation.datefin,
				finGrace: situation.finGrace,
				isInactive: situation.isInactive
			},
			ibanPerso: tiers.iban,
			isPro: organisations.length > 0,
			ibanProConfigured: organisations.length > 0 && organisations.every((o) => o.iban !== null),
			unavailable: false
		};
	} catch (err) {
		// Best-effort, like the other blocks on this page: a Postgres outage must not take the
		// whole homepage down, /cotisation reports it properly through handleError.
		if (isDatabaseUnavailable(err)) {
			return UNAVAILABLE_FINANCIAL_SUMMARY;
		}
		throw err;
	}
}

const NO_COTISATION: CotisationSummary = { status: null, datefin: null, finGrace: null, isInactive: false };
const NO_CHECKLIST: DashboardChecklist = {
	mfaConfigured: null,
	emergencyContactConfigured: null,
	badgeConfigured: null,
	avatarUploaded: false,
	mattermostActivated: null,
	ibanPersoConfigured: false,
	ibanProApplicable: false,
	ibanProConfigured: false
};

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { groups: null, cotisation: NO_COTISATION, checklist: NO_CHECKLIST };
	}

	const pk = authentikPk(locals.user);

	const [apps, financial, mfaDevices, emergencyContacts, rfidUid, myTasks, mattermost] = await Promise.all([
		// Best-effort: a transient Authentik API hiccup shouldn't take down the whole homepage.
		pk ? listUserApplications(pk).catch((): UserApplication[] | null => null) : Promise.resolve(null),
		loadMemberFinancialSummary(locals.user),
		pk ? listMfaDevices(pk).catch(() => null) : Promise.resolve(null),
		pk ? getEmergencyContacts(pk).catch(() => null) : Promise.resolve(null),
		// getRfidUid's own return already uses `null` to mean "no badge yet" — a legitimate,
		// distinct value from a fetch failure, so the failure case is `undefined` here rather than
		// reusing `null` and collapsing the two meanings together.
		pk ? getRfidUid(pk).catch(() => undefined) : Promise.resolve(undefined),
		// "Mes tâches": best-effort too, a database hiccup just hides the block.
		listOpenTasksForMember(locals.user.sub).catch(() => null),
		// Never throws: `unavailable` tells "couldn't check" apart from "no account".
		locals.user.email ? lookupMattermostUsername(locals.user.email) : Promise.resolve({ username: null, unavailable: false })
	]);

	const checklist: DashboardChecklist = {
		mfaConfigured: mfaDevices === null ? null : mfaDevices.length > 0,
		emergencyContactConfigured: emergencyContacts === null ? null : emergencyContacts.length > 0,
		badgeConfigured: rfidUid === undefined ? null : rfidUid !== null,
		avatarUploaded: hasUploadedAvatar(locals.user.email),
		mattermostActivated: mattermost.unavailable ? null : mattermost.username !== null,
		ibanPersoConfigured: financial.unavailable ? null : !!financial.ibanPerso,
		ibanProApplicable: financial.isPro,
		ibanProConfigured: financial.unavailable ? null : financial.ibanProConfigured
	};

	return {
		groups: apps ? groupApps(apps) : null,
		cotisation: financial.cotisation,
		cotisationUnavailable: financial.unavailable,
		checklist,
		myTasks,
		// Where the "Mattermost" checklist item sends the member to sign up / log in.
		mattermostUrl: env.MATTERMOST_URL || null
	};
};
