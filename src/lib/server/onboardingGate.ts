import { getOnboardingStatus } from '$lib/server/authentikAdmin';

// Pages a member who hasn't finished the first-login journey can still reach: the journey itself,
// logging in and out, the avatar images it shows, and the technical endpoints.
const OPEN_PATHS = ['/onboarding', '/login', '/logout', '/avatars', '/healthz', '/csp-report'];

export function isOpenDuringOnboarding(pathname: string): boolean {
	return OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Members known to have finished, so Authentik isn't asked on every request. Only "done" is
// remembered — and only for a while, so clearing the `onboarding` attribute in Authentik takes
// effect again after at most CACHE_MS. Kept in memory rather than in a cookie: a cookie could be
// set by hand to skip the journey.
const CACHE_MS = 10 * 60 * 1000;
const completedUntil = new Map<number, number>();

export function rememberOnboardingCompleted(pk: number): void {
	completedUntil.set(pk, Date.now() + CACHE_MS);
}

// Whether this member still has to go through /onboarding. If Authentik can't be reached, the
// member is let through rather than locking the whole site during an outage.
export async function needsOnboarding(pk: number): Promise<boolean> {
	const until = completedUntil.get(pk);
	if (until && until > Date.now()) return false;
	try {
		const { completedAt } = await getOnboardingStatus(pk);
		if (completedAt) {
			rememberOnboardingCompleted(pk);
			return false;
		}
		return true;
	} catch {
		return false;
	}
}
