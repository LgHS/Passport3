import { getUserProfile, listTrombinoscopeUsernames } from '$lib/server/authentikAdmin';
import type { AuditEvent } from '$lib/server/auditLog';

// "Loïc Keyeux (@iooner)": resolves each distinct actor of these events to their current
// username (actor_sub is their Authentik pk), plus who is listed in the trombinoscope so the
// username can link there. Best-effort — an unresolvable actor just shows their name as logged.
export async function resolveActorUsernames(
	events: Pick<AuditEvent, 'actorSub'>[]
): Promise<{ actorUsernames: Record<string, string>; visibleUsernames: string[] }> {
	const actorPks = [...new Set(events.map((e) => Number(e.actorSub)))].filter(
		(pk) => Number.isInteger(pk) && pk > 0
	);
	if (actorPks.length === 0) return { actorUsernames: {}, visibleUsernames: [] };

	const [profiles, visibleUsernames] = await Promise.all([
		Promise.all(actorPks.map((pk) => getUserProfile(pk).catch(() => null))),
		listTrombinoscopeUsernames().catch(() => [])
	]);
	const actorUsernames: Record<string, string> = {};
	actorPks.forEach((pk, i) => {
		const username = profiles[i]?.username;
		if (username) actorUsernames[String(pk)] = username;
	});
	return { actorUsernames, visibleUsernames };
}
