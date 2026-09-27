import { env } from '$env/dynamic/public';
import { getDb } from '$lib/server/db';
import { getUserGroups, setUserActive, AuthentikUnavailableError } from '$lib/server/authentikAdmin';
import { logAuditEvent } from '$lib/server/auditLog';
import { listSituations } from './cotisations';
import { getComptaSettings } from './settings';
import { tiersDisplayName } from './tiers';

// "Membre ⇔ compte Authentik" (docs/compta.md, "Droit de membre"): when the treasury has switched
// compta_settings.desactivation_auto on, a person whose dues are `expiree` (grace period over)
// loses their Authentik account, and gets it back as soon as they're covered again — but only
// accounts this module itself deactivated (tiers.desactive_le) are ever reactivated, never one an
// admin switched off for another reason.
//
// Off by default and guarded twice more: admins and treasurers are never deactivated, and every
// change goes to the audit log under the "system" actor.

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const SYSTEM_ACTOR = { sub: 'system:adhesionSync', label: 'Synchronisation des adhésions' };

async function isProtected(pk: number): Promise<boolean> {
	const protectedGroups = [env.PUBLIC_AUTHENTIK_ADMIN_GROUP, env.PUBLIC_AUTHENTIK_TRESORIER_GROUP].filter(Boolean);
	const groups = await getUserGroups(pk);
	return groups.some((g) => protectedGroups.includes(g.name));
}

export interface SyncReport {
	desactives: number;
	reactives: number;
	erreurs: number;
}

export async function syncAdhesions(): Promise<SyncReport> {
	const report: SyncReport = { desactives: 0, reactives: 0, erreurs: 0 };
	const settings = await getComptaSettings();
	if (!settings.desactivationAuto) return report;

	const sql = await getDb();
	const flagged = new Set(
		(await sql<{ id: number }[]>`SELECT id FROM tiers WHERE desactive_le IS NOT NULL`).map((r) => r.id)
	);

	for (const { tiers, situation } of await listSituations()) {
		if (tiers.nature !== 'personne_physique' || tiers.authentikPk === null || !tiers.actif) continue;
		const pk = tiers.authentikPk;
		const nom = tiersDisplayName(tiers);
		try {
			if (situation.status === 'expiree' && !flagged.has(tiers.id)) {
				if (await isProtected(pk)) continue;
				const changed = await setUserActive(pk, false);
				await sql`UPDATE tiers SET desactive_le = now(), updated_at = now() WHERE id = ${tiers.id}`;
				if (changed) {
					await logAuditEvent(SYSTEM_ACTOR, 'admin', 'compta.adhesion.desactiver', { pk, email: tiers.email ?? undefined }, {
						tiersId: tiers.id,
						nom,
						datefin: situation.datefin?.toISOString().slice(0, 10) ?? null
					});
					report.desactives += 1;
				}
			} else if (situation.status !== 'expiree' && flagged.has(tiers.id)) {
				const changed = await setUserActive(pk, true);
				await sql`UPDATE tiers SET desactive_le = NULL, updated_at = now() WHERE id = ${tiers.id}`;
				if (changed) {
					await logAuditEvent(SYSTEM_ACTOR, 'admin', 'compta.adhesion.reactiver', { pk, email: tiers.email ?? undefined }, {
						tiersId: tiers.id,
						nom,
						status: situation.status
					});
					report.reactives += 1;
				}
			}
		} catch (err) {
			report.erreurs += 1;
			// An Authentik outage stops the pass (nothing else will work either); a single failing
			// account is logged and skipped so the rest still get processed.
			if (err instanceof AuthentikUnavailableError) throw err;
			console.error(`[adhesionSync] tiers ${tiers.id} (${nom}):`, (err as Error).message);
		}
	}
	return report;
}

let intervalStarted = false;

export function startAdhesionSync(): void {
	if (intervalStarted) return;
	intervalStarted = true;
	const run = () =>
		syncAdhesions()
			.then((r) => {
				if (r.desactives || r.reactives) console.info(`[adhesionSync] ${r.desactives} désactivé(s), ${r.reactives} réactivé(s)`);
			})
			.catch((err) => console.error('[adhesionSync] check failed:', err));
	run();
	setInterval(run, CHECK_INTERVAL_MS);
}
