import type { LayoutServerLoad } from './$types';
import { findUserPkByUsername, getUserProfile, type UserProfile } from '$lib/server/authentikAdmin';

export const load: LayoutServerLoad = async ({ locals }) => {
	let profile: UserProfile | null = null;

	if (locals.user?.preferred_username) {
		try {
			const pk = await findUserPkByUsername(locals.user.preferred_username);
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
