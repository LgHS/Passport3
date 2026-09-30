import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/db';

// The treasury's Gmail mailbox, through the Gmail API — docs/compta.md, "Emails". One mailbox for
// both directions: invoices and reminders go out from it (mailer.ts), and the supplier invoices
// Doccle emails to it are read from it (reception.ts).
//
// Access is an OAuth 2.0 grant given once by a treasurer from /compta/parametres ("Connecter
// Gmail"): Google hands back a refresh token, kept in gmail_connexion (migration 25), encrypted.
// The OAuth client itself (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET) comes from the environment.
//
// Scopes: gmail.send to send, gmail.readonly to read. Nothing here can modify or delete a mail —
// what has already been collected is remembered on our side (reception.ts), not by labelling.

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const UPLOAD_BASE = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/';
const FETCH_TIMEOUT_MS = 20_000;

export class GmailError extends Error {}

// Whether the OAuth client is set up at all — without it there's nothing to connect.
export function isGmailClientConfigured(): boolean {
	return !!env.GMAIL_CLIENT_ID && !!env.GMAIL_CLIENT_SECRET;
}

function client(): { id: string; secret: string } {
	if (!isGmailClientConfigured()) {
		throw new GmailError('Client OAuth Gmail non configuré (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET).');
	}
	return { id: env.GMAIL_CLIENT_ID!, secret: env.GMAIL_CLIENT_SECRET! };
}

// ---------------------------------------------------------------------------------------------
// Refresh token at rest: AES-256-GCM under a key derived from the client secret, so a database
// dump alone doesn't give access to the mailbox. Rotating the client secret invalidates the grant
// on Google's side anyway, so nothing is lost by tying the two together.

function tokenKey(): Buffer {
	return createHash('sha256').update(`passport-gmail-token:${client().secret}`).digest();
}

export function encryptToken(token: string, key: Buffer = tokenKey()): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptToken(stored: string, key: Buffer = tokenKey()): string {
	const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64url'));
	if (!iv || !tag || !data) throw new GmailError('Jeton Gmail illisible : reconnectez la boîte.');
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
	} catch {
		throw new GmailError('Jeton Gmail illisible (GMAIL_CLIENT_SECRET a changé ?) : reconnectez la boîte.');
	}
}

// ---------------------------------------------------------------------------------------------
// Connection

export interface GmailConnexion {
	email: string;
	connecteLe: Date;
	connectePar: string;
}

export async function getGmailConnexion(): Promise<GmailConnexion | null> {
	const sql = await getDb();
	const [row] = await sql<{ email: string; connecte_le: Date; connecte_par: string }[]>`
		SELECT email, connecte_le, connecte_par FROM gmail_connexion WHERE id = 1
	`;
	return row ? { email: row.email, connecteLe: row.connecte_le, connectePar: row.connecte_par } : null;
}

// Where the treasurer is sent to give consent. `prompt=consent` with `access_type=offline` is what
// makes Google return a refresh token every time, including on a reconnection.
export function gmailAuthUrl(redirectUri: string, state: string): string {
	const url = new URL(AUTH_URL);
	url.searchParams.set('client_id', client().id);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', GMAIL_SCOPES.join(' '));
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	url.searchParams.set('state', state);
	return url.toString();
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
	error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
	const { id, secret } = client();
	let res: Response;
	try {
		res = await fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (err) {
		throw new GmailError(`Google injoignable : ${(err as Error).message}`, { cause: err });
	}
	const body = (await res.json().catch(() => ({}))) as TokenResponse;
	if (!res.ok || body.error) {
		// invalid_grant: the grant was revoked, or expired (an OAuth app left in "testing" mode
		// loses its refresh tokens after seven days).
		if (body.error === 'invalid_grant') {
			throw new GmailError('Accès Gmail révoqué ou expiré : reconnectez la boîte dans les paramètres.');
		}
		throw new GmailError(`Google a refusé la demande (${body.error ?? res.status}${body.error_description ? ` : ${body.error_description}` : ''}).`);
	}
	return body;
}

let cached: { token: string; expiresAt: number } | null = null;

// Exchanges the code Google sent back for tokens, checks both scopes were actually granted (the
// consent screen lets the user untick them), and stores the connection.
export async function connecterGmail(code: string, redirectUri: string, actorLabel: string): Promise<GmailConnexion> {
	const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
	if (!tokens.refresh_token || !tokens.access_token) {
		throw new GmailError('Google n’a pas renvoyé de jeton de rafraîchissement : recommencez la connexion.');
	}
	const granted = new Set((tokens.scope ?? '').split(' '));
	const missing = GMAIL_SCOPES.filter((s) => !granted.has(s));
	if (missing.length > 0) {
		throw new GmailError('Les deux autorisations (envoyer et lire) sont nécessaires : recommencez en les cochant toutes les deux.');
	}
	cached = { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
	const profile = (await (await gmailFetch('profile')).json()) as { emailAddress: string };

	const sql = await getDb();
	await sql`
		INSERT INTO gmail_connexion (id, email, refresh_token, connecte_par)
		VALUES (1, ${profile.emailAddress}, ${encryptToken(tokens.refresh_token)}, ${actorLabel})
		ON CONFLICT (id) DO UPDATE SET
			email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token,
			connecte_par = EXCLUDED.connecte_par, connecte_le = now()
	`;
	return (await getGmailConnexion()) as GmailConnexion;
}

// Forgets the mailbox, and tells Google to drop the grant (best effort: what matters is that we
// no longer hold the token).
export async function deconnecterGmail(): Promise<void> {
	const sql = await getDb();
	const [row] = await sql<{ refresh_token: string }[]>`DELETE FROM gmail_connexion WHERE id = 1 RETURNING refresh_token`;
	cached = null;
	if (!row) return;
	try {
		await fetch(REVOKE_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ token: decryptToken(row.refresh_token) }),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (err) {
		console.error('[gmail] revoke failed:', err);
	}
}

async function accessToken(): Promise<string> {
	if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
	const sql = await getDb();
	const [row] = await sql<{ refresh_token: string }[]>`SELECT refresh_token FROM gmail_connexion WHERE id = 1`;
	if (!row) throw new GmailError('Aucune boîte Gmail connectée (Compta → Paramètres).');
	const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decryptToken(row.refresh_token) });
	if (!tokens.access_token) throw new GmailError('Google n’a pas renvoyé de jeton d’accès.');
	cached = { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
	return cached.token;
}

// ---------------------------------------------------------------------------------------------
// API calls

async function gmailFetch(path: string, init?: RequestInit, base = API_BASE): Promise<Response> {
	const token = await accessToken();
	let res: Response;
	try {
		res = await fetch(new URL(path, base), {
			...init,
			headers: { Authorization: `Bearer ${token}`, ...init?.headers },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
	} catch (err) {
		throw new GmailError(`Gmail injoignable : ${(err as Error).message}`, { cause: err });
	}
	if (res.status === 401) cached = null;
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
		throw new GmailError(`Gmail a refusé la demande (${res.status}${body?.error?.message ? ` : ${body.error.message}` : ''}).`);
	}
	return res;
}

// Sends an already-built RFC 822 message. The media upload endpoint takes the message as is (no
// base64 wrapping) and accepts up to 35 MB, well above an invoice and its UBL.
export async function sendRawMessage(mime: Buffer): Promise<string> {
	const res = await gmailFetch(
		'messages/send?uploadType=media',
		{ method: 'POST', headers: { 'Content-Type': 'message/rfc822' }, body: new Uint8Array(mime) },
		UPLOAD_BASE
	);
	return ((await res.json()) as { id: string }).id;
}

export interface GmailHeader {
	name: string;
	value: string;
}

export interface GmailPart {
	partId?: string;
	mimeType?: string;
	filename?: string;
	headers?: GmailHeader[];
	body?: { attachmentId?: string; size?: number; data?: string };
	parts?: GmailPart[];
}

export interface GmailMessage {
	id: string;
	threadId: string;
	// Milliseconds since the epoch, as a string: when Gmail received the message.
	internalDate: string;
	snippet?: string;
	payload: GmailPart;
}

// Ids of the messages matching a Gmail search query, newest first, at most `max`.
export async function listMessageIds(query: string, max = 200): Promise<string[]> {
	const ids: string[] = [];
	let pageToken: string | undefined;
	do {
		const params = new URLSearchParams({ q: query, maxResults: '100' });
		if (pageToken) params.set('pageToken', pageToken);
		const res = await gmailFetch(`messages?${params}`);
		const body = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string };
		for (const m of body.messages ?? []) ids.push(m.id);
		pageToken = body.nextPageToken;
	} while (pageToken && ids.length < max);
	return ids.slice(0, max);
}

export async function getMessage(id: string): Promise<GmailMessage> {
	const res = await gmailFetch(`messages/${encodeURIComponent(id)}?format=full`);
	return (await res.json()) as GmailMessage;
}

export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
	const res = await gmailFetch(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
	const body = (await res.json()) as { data: string };
	return Buffer.from(body.data, 'base64url');
}
