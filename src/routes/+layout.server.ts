import type { LayoutServerLoad } from './$types';
import { getUserProfile, type UserProfile } from '$lib/server/authentikAdmin';
import { authentikPk } from '$lib/types';

export const load: LayoutServerLoad = async ({ locals }) => {
	let profile: UserProfile | null = null;
	const pk = locals.user ? authentikPk(locals.user) : null;

	if (pk) {
		try {
			profile = await getUserProfile(pk);
		} catch {
			// Header falls back to initials and /profile surfaces its own error if this is
			// still unavailable by the time it needs the full record — don't break every
			// page over a transient Authentik API hiccup.
			profile = null;
		}
	}

	return { user: locals.user, avatarUrl: profile?.avatar ?? null, profile };
};
