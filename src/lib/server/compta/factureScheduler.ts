import { getDb } from '$lib/server/db';
import { addUTCMonths, brusselsToday, parseIsoDate, parseMoney, toIsoDate } from './dates';
import { createFacture, validerFacture } from './factures';
import { envoyerFacture } from './factureMail';
import { isMailConfigured } from './mailer';
import type { Periodicite } from './cotisations';

// Issues each organisation's dues invoice at the start of every period — docs/compta.md,
// "Cotisations": the abonnement says the price, the periodicity and the seats; this turns it into
// a validated invoice (numbered, PDF) carrying the cotisation block, so validation itself creates
// the cotisation as `attendue`, and payment will activate it.
//
// Same shape as birthdayScheduler: started once from hooks.server.ts, an hourly check, and the
// work itself idempotent — an abonnement's prochaine_echeance only advances once its invoice
// exists, under a lock so two replicas (or a redeploy overlapping the old process) can't both
// issue it.

const CHECK_INTERVAL_MS = 60 * 60_000;
// Distinct from the migrations' (…001) and numbering (…002) lock ids.
const SCHEDULER_LOCK_ID = 727300003;

interface AbonnementDue {
	id: number;
	tiers_id: number;
	libelle: string;
	prix: string;
	periodicite: Periodicite;
	sieges: number;
	prochaine_echeance: string;
}

function periodEnd(debut: Date, periodicite: Periodicite): Date {
	return addUTCMonths(debut, periodicite === 'mois' ? 1 : 12);
}

const periodFormat = new Intl.DateTimeFormat('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });

function lineLabel(libelle: string, debut: Date, fin: Date, periodicite: Periodicite): string {
	const lastDay = new Date(fin.getTime() - 86_400_000);
	return periodicite === 'mois'
		? `${libelle} — ${periodFormat.format(debut)}`
		: `${libelle} — du ${dayFormat.format(debut)} au ${dayFormat.format(lastDay)}`;
}

// Issues every invoice that is due, one abonnement at a time. Catches up: an abonnement whose
// échéance is several periods in the past (Passport was down, or the abonnement was backdated)
// gets one invoice per missed period. Returns how many invoices were issued.
export async function issueDueInvoices(today: Date = brusselsToday()): Promise<number> {
	const sql = await getDb();
	let issued = 0;

	// The lock is held for the whole pass, in its own transaction; the invoices themselves are
	// created through the regular (committed) path so a failure on one abonnement doesn't roll back
	// the others already issued.
	await sql.begin(async (tx) => {
		const [locked] = await tx<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_ID}) AS ok`;
		if (!locked.ok) return; // another process is on it

		const due = await tx<AbonnementDue[]>`
			SELECT id, tiers_id, libelle, prix, periodicite, sieges, prochaine_echeance::text AS prochaine_echeance
			FROM abonnements
			WHERE actif AND prochaine_echeance <= ${toIsoDate(today)}::date
			ORDER BY prochaine_echeance, id
		`;

		for (const a of due) {
			let debut = parseIsoDate(a.prochaine_echeance);
			try {
				// Bounded catch-up: never more than a year of missed periods in one pass, so a
				// misconfigured abonnement can't flood the books before anyone looks.
				for (let n = 0; n < 12 && debut.getTime() <= today.getTime(); n++) {
					const fin = periodEnd(debut, a.periodicite);
					// Dated at issue (validation's default), not at the period start: numbers must stay
					// chronological, and a catch-up run for a missed period would otherwise backdate an
					// invoice behind ones already numbered. The line says which period it covers.
					const facture = await createFacture({
						sens: 'emise',
						tiersId: a.tiers_id,
						dateEmission: null,
						dateEcheance: null,
						objet: null,
						note: null,
						numero: null,
						lignes: [{ libelle: lineLabel(a.libelle, debut, fin, a.periodicite), quantite: 1, prixUnitaire: parseMoney(a.prix) }],
						cotisation: { type: 'facturee', debut, fin, sieges: a.sieges }
					});
					await validerFacture(facture.id, today);
					// Sent right away when email is set up; a send failure is logged, never blocks the
					// issuing — the treasurer sees "non envoyée" on the invoice and can resend by hand.
					if (await isMailConfigured()) {
						await envoyerFacture(facture.id).catch((err) =>
							console.error(`[factureScheduler] envoi de la facture ${facture.id} échoué:`, (err as Error).message)
						);
					}
					// Advance only after the invoice exists, and on the autocommit connection (not the
					// lock's transaction): a crash between the two re-issues at the next pass rather than
					// silently skipping a period, and a failure on a later abonnement can't roll this back.
					await sql`UPDATE abonnements SET prochaine_echeance = ${toIsoDate(fin)} WHERE id = ${a.id}`;
					issued += 1;
					debut = fin;
				}
			} catch (err) {
				console.error(`[factureScheduler] abonnement ${a.id} (tiers ${a.tiers_id}):`, err);
			}
		}
	});
	return issued;
}

let intervalStarted = false;

export function startFactureScheduler(): void {
	if (intervalStarted) return;
	intervalStarted = true;

	const run = () =>
		issueDueInvoices()
			.then((n) => {
				if (n > 0) console.info(`[factureScheduler] ${n} facture(s) d'abonnement émise(s)`);
			})
			.catch((err) => console.error('[factureScheduler] check failed:', err));
	run();
	setInterval(run, CHECK_INTERVAL_MS);
}
