import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { getComptaSettings, updateComptaSettings } from '$lib/server/compta/settings';
import { isValidIban, normalizeIban } from '$lib/server/bankValidation';
import { deconnecterGmail, getGmailConnexion, GmailError, gmailAuthUrl, isGmailClientConfigured } from '$lib/server/compta/gmail';
import { generateState } from '$lib/server/pkce';
import { setGmailOAuthStateCookie } from '$lib/server/session';
import { COMPTA_EVENEMENTS, isMattermostBotConfigured, type ComptaEvenement } from '$lib/server/compta/comptaNotifications';
import { getSetting, setSetting, SETTING_KEYS } from '$lib/server/appSettings';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

const GMAIL_CALLBACK_PATH = '/compta/parametres/gmail/callback';

// "doccle.be, Doccle.com " → "doccle.be, doccle.com"; null when a piece isn't a domain name.
function normalizeDomaines(raw: string): string | null {
	const domaines = raw
		.split(/[\s,;]+/)
		.map((d) => d.trim().toLowerCase().replace(/^@/, ''))
		.filter(Boolean);
	if (domaines.length === 0) return null;
	if (!domaines.every((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))) return null;
	return [...new Set(domaines)].join(', ');
}

// Mattermost channel ids are 26 lowercase alphanumerics.
const CHANNEL_ID_RE = /^[a-z0-9]{26}$/;
const EVENEMENTS = Object.keys(COMPTA_EVENEMENTS) as ComptaEvenement[];

async function loadNotifications() {
	const actifs = await Promise.all(EVENEMENTS.map(async (e) => (await getSetting(COMPTA_EVENEMENTS[e].key)) === 'true'));
	return {
		botConfigured: isMattermostBotConfigured(),
		channel: (await getSetting(SETTING_KEYS.comptaChannel)) ?? '',
		evenements: EVENEMENTS.map((e, i) => ({ id: e, label: COMPTA_EVENEMENTS[e].label, actif: actifs[i] }))
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const clientConfigured = isGmailClientConfigured();
	return {
		settings: await getComptaSettings(),
		notifications: await loadNotifications(),
		gmail: {
			clientConfigured,
			connexion: clientConfigured ? await getGmailConnexion() : null,
			redirectUri: `${url.origin}${GMAIL_CALLBACK_PATH}`,
			// Outcome of the consent flow, set by the callback.
			resultat: url.searchParams.get('gmail'),
			raison: url.searchParams.get('raison')
		}
	};
};

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const str = (key: string) => String(formData.get(key) ?? '').trim();

		const delaiGraceJours = Number(formData.get('delaiGraceJours'));
		const delaiPaiementJours = Number(formData.get('delaiPaiementJours'));
		const emetteurIban = normalizeIban(str('emetteurIban'));
		const values = {
			delaiGraceJours,
			delaiPaiementJours,
			emetteurNom: str('emetteurNom'),
			emetteurAdresse: str('emetteurAdresse'),
			emetteurNumeroEntreprise: str('emetteurNumeroEntreprise'),
			emetteurEmail: str('emetteurEmail'),
			emetteurIban,
			mentionTva: str('mentionTva'),
			desactivationAuto: formData.has('desactivationAuto'),
			receptionDomaines: str('receptionDomaines'),
			receptionAuto: formData.has('receptionAuto'),
			rappelDelaiJours: Number(formData.get('rappelDelaiJours'))
		};

		if (!Number.isInteger(delaiGraceJours) || delaiGraceJours < 0 || delaiGraceJours > 365) {
			return fail(400, { error: 'Délai de grâce invalide (0 à 365 jours).', values });
		}
		if (!Number.isInteger(delaiPaiementJours) || delaiPaiementJours < 0 || delaiPaiementJours > 365) {
			return fail(400, { error: 'Délai de paiement invalide (0 à 365 jours).', values });
		}
		if (!values.emetteurNom) return fail(400, { error: 'Le nom de l’émetteur est obligatoire.', values });
		if (emetteurIban && !isValidIban(emetteurIban)) return fail(400, { error: 'IBAN invalide (vérifiez le numéro).', values });
		if (!values.mentionTva) return fail(400, { error: 'La mention TVA est obligatoire sur les factures.', values });

		const domaines = normalizeDomaines(values.receptionDomaines);
		if (!domaines) return fail(400, { error: 'Domaines d’expéditeur invalides (ex. : doccle.be).', values });
		values.receptionDomaines = domaines;
		if (!Number.isInteger(values.rappelDelaiJours) || values.rappelDelaiJours < 0 || values.rappelDelaiJours > 365) {
			return fail(400, { error: 'Délai de rappel invalide (0 à 365 jours).', values });
		}

		await updateComptaSettings(values);
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.settings.update', {}, {
			delaiGraceJours,
			delaiPaiementJours,
			desactivationAuto: values.desactivationAuto,
			receptionDomaines: values.receptionDomaines,
			receptionAuto: values.receptionAuto,
			rappelDelaiJours: values.rappelDelaiJours
		});
		return { success: true, values };
	},

	notifications: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const channel = String(formData.get('channel') ?? '').trim();
		if (channel && !CHANNEL_ID_RE.test(channel)) {
			return fail(400, { error: 'Identifiant de canal invalide (26 caractères, visible dans « Afficher les informations » du canal).' });
		}
		const avant = await loadNotifications();
		const apres: Record<string, boolean> = {};
		for (const e of EVENEMENTS) {
			apres[e] = formData.has(e);
			await setSetting(COMPTA_EVENEMENTS[e].key, apres[e] ? 'true' : null);
		}
		await setSetting(SETTING_KEYS.comptaChannel, channel || null);
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.notifications.update', {}, {
			avant: { channel: avant.channel || null, ...Object.fromEntries(avant.evenements.map((e) => [e.id, e.actif])) },
			apres: { channel: channel || null, ...apres }
		});
		return { success: true, notifications: true };
	},

	// Sends the treasurer to Google's consent screen; the callback route stores the access.
	connecterGmail: async ({ locals, cookies, url }) => {
		requireTresorierUser(locals);
		let target: string;
		try {
			const state = generateState();
			target = gmailAuthUrl(`${url.origin}${GMAIL_CALLBACK_PATH}`, state);
			setGmailOAuthStateCookie(cookies, state);
		} catch (err) {
			if (err instanceof GmailError) return fail(400, { error: err.message });
			throw err;
		}
		redirect(303, target);
	},

	deconnecterGmail: async ({ locals }) => {
		const tresorier = requireTresorierUser(locals);
		const connexion = await getGmailConnexion();
		await deconnecterGmail();
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.gmail.disconnect', {}, {
			email: connexion?.email ?? null
		});
		return { success: true, gmailDeconnecte: true };
	}
};
