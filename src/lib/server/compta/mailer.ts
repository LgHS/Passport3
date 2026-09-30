import MailComposer from 'nodemailer/lib/mail-composer';
import { getComptaSettings } from './settings';
import { getGmailConnexion, GmailError, isGmailClientConfigured, sendRawMessage } from './gmail';

// Outgoing email — invoices and payment reminders. Sent through the Gmail API from the treasury's
// connected mailbox (gmail.ts); nodemailer only builds the message, it doesn't transport it.
// Without a connected mailbox nothing is sent and callers say so, rather than failing — a dev
// checkout or a fresh deploy must not silently swallow invoices.

export interface Mail {
	to: string[];
	subject: string;
	text: string;
	attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export class MailError extends Error {}

export const MAIL_NON_CONFIGURE = 'Aucune boîte Gmail connectée (Compta → Paramètres).';

export async function isMailConfigured(): Promise<boolean> {
	return isGmailClientConfigured() && (await getGmailConnexion()) !== null;
}

// The RFC 822 message, as bytes. Exported for the tests.
export async function buildMime(mail: Mail, from: { name: string; address: string }): Promise<Buffer> {
	return new MailComposer({
		from,
		to: mail.to,
		subject: mail.subject,
		text: mail.text,
		attachments: mail.attachments
	})
		.compile()
		.build();
}

export async function sendMail(mail: Mail): Promise<void> {
	if (mail.to.length === 0) throw new MailError('Aucun destinataire.');
	const connexion = isGmailClientConfigured() ? await getGmailConnexion() : null;
	if (!connexion) throw new MailError(MAIL_NON_CONFIGURE);
	const settings = await getComptaSettings();
	try {
		// Gmail only sends as the connected account (or one of its aliases), whatever From says.
		await sendRawMessage(await buildMime(mail, { name: settings.emetteurNom, address: connexion.email }));
	} catch (err) {
		if (err instanceof GmailError) throw new MailError(err.message, { cause: err });
		throw new MailError(`Envoi impossible : ${(err as Error).message}`, { cause: err });
	}
}
