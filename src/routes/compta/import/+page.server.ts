import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { importDolibarr } from '$lib/server/compta/importDolibarr';
import { DolibarrUnavailableError } from '$lib/server/dolibarr';
import { AuthentikUnavailableError } from '$lib/server/authentikAdmin';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const sql = await getDb();
	const [counts] = await sql<{ tiers: number; cotisations: number; imported: number }[]>`
		SELECT (SELECT count(*)::int FROM tiers) AS tiers,
		       (SELECT count(*)::int FROM cotisations) AS cotisations,
		       (SELECT count(*)::int FROM tiers WHERE dolibarr_member_id IS NOT NULL OR dolibarr_soc_id IS NOT NULL) AS imported
	`;
	return {
		// Shown so a treasurer sees which instance (preprod/prod) they're about to import from.
		dolibarrUrl: env.DOLIBARR_URL ?? null,
		counts
	};
};

export const actions: Actions = {
	run: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const dryRun = formData.get('mode') !== 'apply';
		try {
			const report = await importDolibarr(dryRun);
			if (!dryRun) {
				await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.import.dolibarr', {}, {
					tiers: report.tiers,
					liens: report.liens,
					cotisations: report.cotisations,
					authentikLinked: report.authentikLinked,
					warnings: report.warnings.length
				});
			}
			return { report };
		} catch (err) {
			if (err instanceof DolibarrUnavailableError) {
				return fail(503, { error: 'Dolibarr est injoignable — rien n’a été importé.' });
			}
			if (err instanceof AuthentikUnavailableError) {
				return fail(503, { error: 'Authentik est injoignable — rien n’a été importé.' });
			}
			throw err;
		}
	}
};
