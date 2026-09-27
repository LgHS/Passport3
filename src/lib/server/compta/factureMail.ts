import { getComptaSettings } from './settings';
import { getFacture, marquerEnvoyee, readFacturePdf, readFactureUbl, type Facture } from './factures';
import { getTiers, tiersDisplayName } from './tiers';
import { listLiensOfOrganisation, lienEnCours } from './liens';
import { brusselsToday } from './dates';
import { isMailConfigured, MailError, sendMail } from './mailer';

// Emailing an issued invoice (PDF + UBL attached) to the customer — docs/compta.md, "Emails".
// Recipients: the tiers' own email, plus the people linked to an organisation with
// `destinataire_factures` (see tiers_liens). Used by the invoice page's button and, when SMTP is
// configured, by the subscription scheduler right after issuing.

const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'long', timeZone: 'UTC' });
const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

export async function destinatairesDe(facture: Facture): Promise<string[]> {
	const tiers = await getTiers(facture.tiersId);
	if (!tiers) return [];
	const emails = new Set<string>();
	if (tiers.email) emails.add(tiers.email.toLowerCase());
	if (tiers.nature === 'personne_morale') {
		const today = brusselsToday();
		for (const lien of await listLiensOfOrganisation(tiers.id)) {
			if (lien.destinataireFactures && lienEnCours(lien, today) && lien.personne.email) {
				emails.add(lien.personne.email.toLowerCase());
			}
		}
	}
	return [...emails];
}

export class FactureMailError extends MailError {}

// Sends, then records when and to whom. Throws FactureMailError with a message fit for the UI.
export async function envoyerFacture(factureId: number): Promise<string[]> {
	if (!isMailConfigured()) throw new FactureMailError('SMTP non configuré : renseignez SMTP_URL et SMTP_FROM.');
	const facture = await getFacture(factureId);
	if (!facture || facture.sens !== 'emise') throw new FactureMailError('Facture introuvable.');
	if (facture.statut === 'brouillon' || facture.statut === 'annulee') {
		throw new FactureMailError('Seule une facture validée s’envoie.');
	}
	const to = await destinatairesDe(facture);
	if (to.length === 0) throw new FactureMailError('Aucune adresse email pour ce tiers (fiche ou personne « reçoit les factures »).');

	const [pdf, ubl, settings, tiers] = await Promise.all([
		readFacturePdf(facture.id),
		readFactureUbl(facture.id),
		getComptaSettings(),
		getTiers(facture.tiersId)
	]);
	if (!pdf) throw new FactureMailError('Le PDF de cette facture est introuvable.');

	const credit = facture.type === 'note_de_credit';
	const nom = tiers ? tiersDisplayName(tiers) : '';
	const subject = `${credit ? 'Note de crédit' : 'Facture'} ${facture.numero} — ${settings.emetteurNom}`;
	const lines = [
		`Bonjour${nom ? ` ${nom}` : ''},`,
		'',
		credit
			? `Veuillez trouver ci-joint la note de crédit ${facture.numero} d'un montant de ${amountFormat.format(Math.abs(facture.total))}.`
			: `Veuillez trouver ci-joint la facture ${facture.numero} d'un montant de ${amountFormat.format(facture.total)}, payable pour le ${facture.dateEcheance ? dateFormat.format(facture.dateEcheance) : '—'}.`,
		...(credit
			? []
			: [
					'',
					`IBAN : ${settings.emetteurIban}`,
					`Communication structurée : ${facture.communicationStructuree ?? '—'}`
				]),
		'',
		'Le fichier UBL joint est destiné à votre plateforme de facturation électronique (Peppol).',
		'',
		settings.mentionTva,
		'',
		settings.emetteurNom,
		settings.emetteurEmail
	];

	const base = (facture.numero ?? `facture-${facture.id}`).replace(/[^A-Za-z0-9._-]/g, '_');
	await sendMail({
		to,
		subject,
		text: lines.join('\n'),
		attachments: [
			{ filename: `${base}.pdf`, content: pdf, contentType: 'application/pdf' },
			...(ubl ? [{ filename: `${base}.xml`, content: ubl, contentType: 'application/xml' }] : [])
		]
	});
	await marquerEnvoyee(facture.id, to);
	return to;
}
