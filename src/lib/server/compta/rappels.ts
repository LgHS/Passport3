import { getDb } from '$lib/server/db';
import { getSetting, setSetting, SETTING_KEYS } from '$lib/server/appSettings';
import { addUTCDays, brusselsToday, parseIsoDate, parseMoney, toIsoDate } from './dates';
import { getComptaSettings, type ComptaSettings } from './settings';
import { getFacture, readFacturePdf, readFactureUbl, type Facture } from './factures';
import { destinatairesDe } from './factureMail';
import { isMailConfigured, MAIL_NON_CONFIGURE, MailError, sendMail } from './mailer';
import { tiersDisplayName, type TiersNature } from './tiers';
import { lienPassport, notifierCompta } from './comptaNotifications';

// Payment reminders for issued invoices past their due date — docs/compta.md, "Rappels". The app
// proposes, a treasurer decides: nothing here sends by itself. An invoice is proposed once it's
// `rappelDelaiJours` past due, then again the same number of days after each reminder sent. Every
// reminder that left is kept (table rappels, migration 26), with its text and what was owed.

export class RappelError extends Error {}

const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'long', timeZone: 'UTC' });
const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

export interface FactureEchue {
	id: number;
	numero: string;
	tiersId: number;
	tiersNom: string;
	dateEmission: Date;
	dateEcheance: Date;
	joursRetard: number;
	total: number;
	// What's still owed: the total less what bank movements already cover.
	reste: number;
	communicationStructuree: string | null;
	rappelsEnvoyes: number;
	dernierRappel: Date | null;
	// Due for a (new) reminder today, as opposed to merely overdue.
	aRelancer: boolean;
	// The day it becomes due for one, when it isn't yet.
	prochainRappel: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Whether an overdue invoice is due for a reminder on `today`, and if not, when it will be.
// `dernierRappel` is the calendar day (Brussels) the last reminder left.
export function echeanceRappel(
	dateEcheance: Date,
	dernierRappel: Date | null,
	today: Date,
	delaiJours: number
): { aRelancer: boolean; prochainRappel: Date | null } {
	const depuis = dernierRappel && dernierRappel > dateEcheance ? dernierRappel : dateEcheance;
	const prochain = addUTCDays(depuis, delaiJours);
	// Never before the day after the due date: an invoice due today isn't late.
	const auPlusTot = addUTCDays(dateEcheance, 1);
	const jour = prochain < auPlusTot ? auPlusTot : prochain;
	return jour <= today ? { aRelancer: true, prochainRappel: null } : { aRelancer: false, prochainRappel: jour };
}

interface EchueRow {
	id: number;
	numero: string;
	tiers_id: number;
	tiers_nom: string;
	tiers_prenom: string | null;
	tiers_nature: TiersNature;
	date_emission: string;
	date_echeance: string;
	total: string;
	lettre: string;
	communication_structuree: string | null;
	rappels: number;
	dernier_rappel: string | null;
}

// Every issued invoice past its due date and not fully paid, the most overdue first. Credit
// notes are never chased, and an invoice fully covered by movements but not yet marked paid
// isn't either.
export async function listFacturesEchues(today: Date = brusselsToday()): Promise<FactureEchue[]> {
	const sql = await getDb();
	const settings = await getComptaSettings();
	const rows = await sql<EchueRow[]>`
		SELECT f.id, f.numero, f.tiers_id, t.nom AS tiers_nom, t.prenom AS tiers_prenom, t.nature AS tiers_nature,
		       f.date_emission::text AS date_emission, f.date_echeance::text AS date_echeance, f.total,
		       f.communication_structuree,
		       COALESCE((SELECT sum(l.montant) FROM lettrages l WHERE l.cible_type = 'facture' AND l.cible_id = f.id), 0) AS lettre,
		       (SELECT count(*)::int FROM rappels r WHERE r.facture_id = f.id) AS rappels,
		       (SELECT max((r.envoye_le AT TIME ZONE 'Europe/Brussels')::date)::text FROM rappels r WHERE r.facture_id = f.id) AS dernier_rappel
		FROM factures f JOIN tiers t ON t.id = f.tiers_id
		WHERE f.sens = 'emise' AND f.type = 'facture' AND f.statut = 'validee'
		  AND f.date_echeance IS NOT NULL AND f.date_echeance < ${toIsoDate(today)}::date
		ORDER BY f.date_echeance, f.id
	`;
	return rows
		.map((r) => {
			const dateEcheance = parseIsoDate(r.date_echeance);
			const dernierRappel = r.dernier_rappel ? parseIsoDate(r.dernier_rappel) : null;
			const total = parseMoney(r.total);
			return {
				id: r.id,
				numero: r.numero,
				tiersId: r.tiers_id,
				tiersNom: tiersDisplayName({ nature: r.tiers_nature, nom: r.tiers_nom, prenom: r.tiers_prenom }),
				dateEmission: parseIsoDate(r.date_emission),
				dateEcheance,
				joursRetard: Math.round((today.getTime() - dateEcheance.getTime()) / DAY_MS),
				total,
				reste: Math.round((total - parseMoney(r.lettre)) * 100) / 100,
				communicationStructuree: r.communication_structuree,
				rappelsEnvoyes: r.rappels,
				dernierRappel,
				...echeanceRappel(dateEcheance, dernierRappel, today, settings.rappelDelaiJours)
			};
		})
		.filter((f) => f.reste > 0.005);
}

// The reminder's subject and text. The tone follows the rank: a first reminder assumes an
// oversight, the third and later say it's the last. Exported for the preview and the tests.
export function texteRappel(
	f: Pick<FactureEchue, 'numero' | 'tiersNom' | 'dateEmission' | 'dateEcheance' | 'total' | 'reste' | 'communicationStructuree' | 'dernierRappel'>,
	niveau: number,
	settings: Pick<ComptaSettings, 'emetteurNom' | 'emetteurEmail' | 'emetteurIban' | 'mentionTva'>,
	complement: string | null = null
): { subject: string; text: string } {
	const partiel = f.reste < f.total - 0.005;
	const facture = `la facture ${f.numero} du ${dateFormat.format(f.dateEmission)}, d'un montant de ${amountFormat.format(f.total)}, échue le ${dateFormat.format(f.dateEcheance)}`;
	const intro =
		niveau <= 1
			? `Sauf erreur de notre part, nous n'avons pas encore reçu le paiement de ${facture}.`
			: niveau === 2
				? `Malgré notre rappel${f.dernierRappel ? ` du ${dateFormat.format(f.dernierRappel)}` : ''}, ${facture}, reste impayée.`
				: `Malgré nos rappels précédents, ${facture}, reste impayée. Ceci est notre dernier rappel avant d'en référer à notre organe d'administration.`;
	const lines = [
		`Bonjour${f.tiersNom ? ` ${f.tiersNom}` : ''},`,
		'',
		intro,
		'',
		partiel
			? `Compte tenu de ce que nous avons déjà reçu, il reste ${amountFormat.format(f.reste)} à payer.`
			: `Montant à payer : ${amountFormat.format(f.reste)}.`,
		`IBAN : ${settings.emetteurIban}`,
		`Communication structurée : ${f.communicationStructuree ?? '—'}`,
		'',
		...(complement?.trim() ? [complement.trim(), ''] : []),
		'La facture est jointe à ce message. Si votre paiement a croisé ce rappel, merci de ne pas en tenir compte.',
		'',
		settings.mentionTva,
		'',
		settings.emetteurNom,
		settings.emetteurEmail
	];
	const rang = niveau <= 1 ? 'Rappel' : niveau === 2 ? 'Deuxième rappel' : 'Dernier rappel';
	return { subject: `${rang} — facture ${f.numero} — ${settings.emetteurNom}`, text: lines.join('\n') };
}

export interface Rappel {
	id: number;
	factureId: number;
	factureNumero: string | null;
	tiersNom: string;
	niveau: number;
	envoyeLe: Date;
	envoyeA: string;
	envoyePar: string;
	reste: number;
	message: string;
}

interface RappelRow {
	id: number;
	facture_id: number;
	numero: string | null;
	tiers_nom: string;
	tiers_prenom: string | null;
	tiers_nature: TiersNature;
	niveau: number;
	envoye_le: Date;
	envoye_a: string;
	envoye_par: string;
	reste: string;
	message: string;
}

export async function listRappels(factureId?: number): Promise<Rappel[]> {
	const sql = await getDb();
	const rows = await sql<RappelRow[]>`
		SELECT r.id, r.facture_id, f.numero, t.nom AS tiers_nom, t.prenom AS tiers_prenom, t.nature AS tiers_nature,
		       r.niveau, r.envoye_le, r.envoye_a, r.envoye_par, r.reste, r.message
		FROM rappels r JOIN factures f ON f.id = r.facture_id JOIN tiers t ON t.id = f.tiers_id
		${factureId ? sql`WHERE r.facture_id = ${factureId}` : sql``}
		ORDER BY r.id DESC
		LIMIT 300
	`;
	return rows.map((r) => ({
		id: r.id,
		factureId: r.facture_id,
		factureNumero: r.numero,
		tiersNom: tiersDisplayName({ nature: r.tiers_nature, nom: r.tiers_nom, prenom: r.tiers_prenom }),
		niveau: r.niveau,
		envoyeLe: r.envoye_le,
		envoyeA: r.envoye_a,
		envoyePar: r.envoye_par,
		reste: parseMoney(r.reste),
		message: r.message
	}));
}

// What would be sent for this invoice right now: recipients and text. Null when the invoice
// isn't overdue (paid in the meantime, cancelled…).
export async function apercuRappel(
	factureId: number,
	complement: string | null = null
): Promise<{ facture: FactureEchue; niveau: number; to: string[]; subject: string; text: string } | null> {
	const echue = (await listFacturesEchues()).find((f) => f.id === factureId);
	if (!echue) return null;
	const facture = (await getFacture(factureId)) as Facture;
	const niveau = echue.rappelsEnvoyes + 1;
	const settings = await getComptaSettings();
	return { facture: echue, niveau, to: await destinatairesDe(facture), ...texteRappel(echue, niveau, settings, complement) };
}

// Sends one reminder, the invoice attached, and records it. The invoice's state is read again
// here: between the list being displayed and the button being pressed, it may have been paid.
export async function envoyerRappel(factureId: number, actorLabel: string, complement: string | null = null): Promise<Rappel> {
	if (!(await isMailConfigured())) throw new RappelError(MAIL_NON_CONFIGURE);
	const apercu = await apercuRappel(factureId, complement);
	if (!apercu) throw new RappelError('Cette facture n’est plus à relancer (payée, annulée ou pas encore échue).');
	const { facture, niveau, to, subject, text } = apercu;
	if (to.length === 0) throw new RappelError(`Facture ${facture.numero} : aucune adresse email pour ce tiers.`);

	const [pdf, ubl] = await Promise.all([readFacturePdf(factureId), readFactureUbl(factureId)]);
	const base = facture.numero.replace(/[^A-Za-z0-9._-]/g, '_');
	try {
		await sendMail({
			to,
			subject,
			text,
			attachments: [
				...(pdf ? [{ filename: `${base}.pdf`, content: pdf, contentType: 'application/pdf' }] : []),
				...(ubl ? [{ filename: `${base}.xml`, content: ubl, contentType: 'application/xml' }] : [])
			]
		});
	} catch (err) {
		if (err instanceof MailError) throw new RappelError(`Facture ${facture.numero} : ${err.message}`, { cause: err });
		throw err;
	}

	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO rappels (facture_id, niveau, envoye_a, envoye_par, reste, message)
		VALUES (${factureId}, ${niveau}, ${to.join(', ')}, ${actorLabel}, ${facture.reste}, ${text})
		RETURNING id
	`;
	return (await listRappels(factureId)).find((r) => r.id === row.id) as Rappel;
}

// ---------------------------------------------------------------------------------------------
// Weekly digest on Mattermost, when switched on: what's waiting for a reminder. It only tells the
// treasury there's something to decide — sending stays a treasurer's action.

const DIGEST_INTERVAL_MS = 6 * 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
	try {
		const today = brusselsToday();
		const last = await getSetting(SETTING_KEYS.comptaEchuesLastSent);
		if (last && addUTCDays(parseIsoDate(last), 7) > today) return;
		const aRelancer = (await listFacturesEchues(today)).filter((f) => f.aRelancer);
		if (aRelancer.length === 0) return;
		const total = aRelancer.reduce((a, f) => a + f.reste, 0);
		const sent = await notifierCompta(
			'echues',
			`⏰ ${aRelancer.length} facture${aRelancer.length > 1 ? 's' : ''} échue${aRelancer.length > 1 ? 's' : ''} à relancer, ` +
				`pour ${amountFormat.format(total)} : ${lienPassport('/compta/rappels', 'Rappels')}`
		);
		if (sent) await setSetting(SETTING_KEYS.comptaEchuesLastSent, toIsoDate(today));
	} catch (err) {
		console.error('[rappels] digest failed:', err);
	}
}

export function startRappelDigest(): void {
	if (timer) return;
	timer = setInterval(tick, DIGEST_INTERVAL_MS);
	timer.unref?.();
	setTimeout(tick, 10 * 60 * 1000).unref?.();
}
