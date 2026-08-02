import type { UserProfile } from './authentikAdmin';

// In-process only — this app runs as a single long-lived Node process, not a serverless/
// multi-instance deployment, so a shared external store (Redis, etc.) would be unwarranted
// complexity here. TTL is a safety net against edits made directly in Authentik's own admin UI;
// the primary freshness mechanism is the explicit setCachedProfile() call in updateUserProfile.
const TTL_MS = 60_000;
const cache = new Map<number, { profile: UserProfile; expiresAt: number }>();

export function getCachedProfile(pk: number): UserProfile | null {
	const entry = cache.get(pk);
	if (!entry || entry.expiresAt < Date.now()) {
		cache.delete(pk);
		return null;
	}
	return entry.profile;
}

export function setCachedProfile(pk: number, profile: UserProfile): void {
	cache.set(pk, { profile, expiresAt: Date.now() + TTL_MS });
}
