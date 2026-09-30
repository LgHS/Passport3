import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, GmailError } from '$lib/server/compta/gmail';
import { buildMime } from '$lib/server/compta/mailer';

const key = (secret: string) => createHash('sha256').update(secret).digest();

describe('refresh token at rest', () => {
	it('round-trips, and never stores the token in clear', () => {
		const stored = encryptToken('1//refresh-token-value', key('a'));
		expect(stored).not.toContain('refresh-token-value');
		expect(decryptToken(stored, key('a'))).toBe('1//refresh-token-value');
	});

	it('gives a different ciphertext each time', () => {
		expect(encryptToken('t', key('a'))).not.toBe(encryptToken('t', key('a')));
	});

	it('refuses another key, or a tampered value', () => {
		const stored = encryptToken('t', key('a'));
		expect(() => decryptToken(stored, key('b'))).toThrow(GmailError);
		const [iv, tag, data] = stored.split('.');
		const flipped = Buffer.from(data, 'base64url');
		flipped[0] ^= 1;
		expect(() => decryptToken([iv, tag, flipped.toString('base64url')].join('.'), key('a'))).toThrow(GmailError);
		expect(() => decryptToken('n’importe quoi', key('a'))).toThrow(GmailError);
	});
});

describe('buildMime', () => {
	it('builds a message with its attachments', async () => {
		const mime = (
			await buildMime(
				{
					to: ['client@exemple.test', 'compta@exemple.test'],
					subject: 'Facture 2026-0001 — Liège Hackerspace',
					text: 'Bonjour,\n\nVeuillez trouver ci-joint la facture.',
					attachments: [
						{ filename: '2026-0001.pdf', content: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' },
						{ filename: '2026-0001.xml', content: Buffer.from('<Invoice/>'), contentType: 'application/xml' }
					]
				},
				{ name: 'Liège Hackerspace ASBL', address: 'compta@exemple.test' }
			)
		).toString('utf8');
		expect(mime).toMatch(/^From: .*<compta@exemple\.test>/m);
		expect(mime).toMatch(/^To: client@exemple\.test, compta@exemple\.test/m);
		expect(mime).toContain('filename=2026-0001.pdf');
		expect(mime).toContain('Content-Type: application/xml; name=2026-0001.xml');
		expect(mime).toContain(Buffer.from('%PDF-1.7').toString('base64'));
	});

	it('does not let a subject inject a header', async () => {
		const mime = (
			await buildMime({ to: ['a@exemple.test'], subject: 'Facture\r\nBcc: fraude@exemple.test', text: 'x' }, { name: 'X', address: 'c@exemple.test' })
		).toString('utf8');
		expect(mime).not.toMatch(/^Bcc:/m);
	});
});
