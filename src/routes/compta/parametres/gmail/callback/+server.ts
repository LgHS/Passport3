import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { connecterGmail, GmailError } from '$lib/server/compta/gmail';
import { clearGmailOAuthStateCookie, GMAIL_OAUTH_STATE_COOKIE } from '$lib/server/session';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

// Where Google sends the treasurer back after the consent screen opened by /compta/parametres'
// "Connecter Gmail". The outcome is shown by that page, from the query string.
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const tresorier = requireTresorierUser(locals);
	const expected = cookies.get(GMAIL_OAUTH_STATE_COOKIE);
	clearGmailOAuthStateCookie(cookies);

	const back = (params: Record<string, string>) => redirect(303, `/compta/parametres?${new URLSearchParams(params)}#gmail`);

	const state = url.searchParams.get('state');
	if (!expected || !state || state !== expected) back({ gmail: 'erreur', raison: 'La demande a expiré : recommencez la connexion.' });
	// The treasurer closed the consent screen or refused.
	if (url.searchParams.get('error')) back({ gmail: 'erreur', raison: 'Connexion annulée.' });
	const code = url.searchParams.get('code');
	if (!code) back({ gmail: 'erreur', raison: 'Réponse de Google incomplète.' });

	try {
		const connexion = await connecterGmail(code!, `${url.origin}${url.pathname}`, displayName(tresorier));
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.gmail.connect', {}, {
			email: connexion.email
		});
	} catch (err) {
		if (err instanceof GmailError) back({ gmail: 'erreur', raison: err.message });
		throw err;
	}
	back({ gmail: 'ok' });
	// `back` always throws (redirect); this keeps the handler's return type honest.
	return new Response(null, { status: 204 });
};
