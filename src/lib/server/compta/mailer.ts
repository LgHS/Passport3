import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '$env/dynamic/private';

// Outgoing email, the first in the app (invitations go through Authentik). Configured by SMTP_URL
// and SMTP_FROM (see .env.example); without them nothing is sent and callers say so, rather than
// failing — a dev checkout or a fresh deploy must not silently swallow invoices.

export interface Mail {
	to: string[];
	subject: string;
	text: string;
	attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export function isMailConfigured(): boolean {
	return !!env.SMTP_URL && !!env.SMTP_FROM;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
	if (!transporter) {
		if (!isMailConfigured()) throw new MailError('SMTP non configuré (SMTP_URL / SMTP_FROM).');
		transporter = nodemailer.createTransport(env.SMTP_URL);
	}
	return transporter;
}

export class MailError extends Error {}

export async function sendMail(mail: Mail): Promise<void> {
	if (mail.to.length === 0) throw new MailError('Aucun destinataire.');
	try {
		await getTransporter().sendMail({
			from: env.SMTP_FROM,
			to: mail.to.join(', '),
			subject: mail.subject,
			text: mail.text,
			attachments: mail.attachments
		});
	} catch (err) {
		if (err instanceof MailError) throw err;
		throw new MailError(`Envoi impossible : ${(err as Error).message}`, { cause: err });
	}
}
