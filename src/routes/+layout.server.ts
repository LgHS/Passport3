import type { LayoutServerLoad } from './$types';
import { getUserProfile, type UserProfile } from '$lib/server/authentikAdmin';
import { getCotisationStatus } from '$lib/server/dolibarr';
import { getSystemStatus } from '$lib/server/health';
import { getMattermostCacheStatus } from '$lib/server/mattermost';
import { authentikPk, type CotisationStatus, type SystemStatus } from '$lib/types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const pk = locals.user ? authentikPk(locals.user) : null;
	const email = locals.user?.email;

	// Synchronous and never triggers a fetch itself — see getMattermostCacheStatus()'s own comment
	// for why this doesn't belong in the Promise.all below with the two live checks.
	const mattermostCacheStatus = locals.user ? getMattermostCacheStatus() : null;

	const [profile, cotisationStatus, systemStatus] = await Promise.all([
		pk
			? getUserProfile(pk).catch((): UserProfile | null => {
					// Header falls back to initials and /profile surfaces its own error if this is
					// still unavailable by the time it needs the full record — don't break every
					// page over a transient Authentik API hiccup.
					return null;
				})
			: Promise.resolve<UserProfile | null>(null),
		email
			? getCotisationStatus(email).catch((): CotisationStatus | null => {
					// Same rationale: the topbar just hides itself rather than breaking every page
					// over a transient Dolibarr API hiccup.
					return null;
				})
			: Promise.resolve<CotisationStatus | null>(null),
		// Footer-only, shown to any logged-in member — getSystemStatus() never throws itself
		// (each check swallows its own failure), so no .catch() needed here.
		locals.user ? getSystemStatus() : Promise.resolve<SystemStatus | null>(null)
	]);

	return {
		user: locals.user,
		avatarUrl: profile?.avatar ?? null,
		profile,
		cotisationStatus,
		systemStatus,
		mattermostCacheStatus
	};
};
