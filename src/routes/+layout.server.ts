import type { LayoutServerLoad } from './$types';
import { getUserProfile, type UserProfile } from '$lib/server/authentikAdmin';
import { getCotisationStatus } from '$lib/server/dolibarr';
import { authentikPk, type CotisationStatus } from '$lib/types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const pk = locals.user ? authentikPk(locals.user) : null;
	const email = locals.user?.email;

	const [profile, cotisationStatus] = await Promise.all([
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
			: Promise.resolve<CotisationStatus | null>(null)
	]);

	return { user: locals.user, avatarUrl: profile?.avatar ?? null, profile, cotisationStatus };
};
