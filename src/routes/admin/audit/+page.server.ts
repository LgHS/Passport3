import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';
import { listAuditEvents } from '$lib/server/auditLog';
import { getUserProfile } from '$lib/server/authentikAdmin';

export interface AuditTargetLabel {
	firstName: string;
	username: string;
}

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals);

	// v1: most recent 200, no pagination yet — add one if/when this actually fills up enough to
	// need it rather than building it ahead of time.
	const events = await listAuditEvents(200);

	// Resolve each *unique* target once (repeat targets across events are common — an admin
	// editing the same member's profile then their tag, say), profileCache.ts also dedupes this
	// same pk across the two lookups this ends up doing in the same request either way.
	const uniquePks = [...new Set(events.map((e) => e.targetPk).filter((pk): pk is number => pk !== null))];
	const profiles = await Promise.all(
		uniquePks.map((pk) => getUserProfile(pk).catch(() => null))
	);

	const targetLabels: Record<number, AuditTargetLabel> = {};
	uniquePks.forEach((pk, i) => {
		const profile = profiles[i];
		if (profile) {
			targetLabels[pk] = { firstName: profile.name.trim().split(/\s+/)[0] ?? profile.username, username: profile.username };
		}
	});

	return { events, targetLabels };
};
