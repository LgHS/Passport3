import { env } from '$env/dynamic/private';
import { getSetting, SETTING_KEYS, type SettingKey } from '$lib/server/appSettings';
import { postToChannel } from '$lib/server/mattermostBot';

// Treasury notifications on Mattermost — docs/compta.md, "Emails et notifications". One channel,
// picked in /compta/parametres, and one switch per event, all off by default. Best effort like
// everything Mattermost here: a notification that can't be posted never fails what triggered it.
//
// Messages name documents and amounts, never a member's bank details.

export const COMPTA_EVENEMENTS = {
	reception: { key: SETTING_KEYS.comptaAnnounceReception, label: 'Factures reçues par email (Doccle) à valider' },
	notesDeFrais: { key: SETTING_KEYS.comptaAnnounceNotesDeFrais, label: 'Note de frais soumise par un membre' },
	echues: { key: SETTING_KEYS.comptaAnnounceEchues, label: 'Récapitulatif hebdomadaire des factures échues à relancer' },
	abonnements: { key: SETTING_KEYS.comptaAnnounceAbonnements, label: 'Factures d’abonnement émises par le planificateur' }
} as const satisfies Record<string, { key: SettingKey; label: string }>;

export type ComptaEvenement = keyof typeof COMPTA_EVENEMENTS;

export function isMattermostBotConfigured(): boolean {
	return !!env.MATTERMOST_URL && !!env.MATTERMOST_BOT_TOKEN;
}

// Link to a Passport page, for a message. The public origin is read off the OIDC redirect URI, as
// tasks.ts does; without it the message carries the bare text.
export function lienPassport(path: string, texte: string): string {
	let base = '';
	try {
		base = env.AUTHENTIK_REDIRECT_URI ? new URL(env.AUTHENTIK_REDIRECT_URI).origin : '';
	} catch {
		// Unparseable: no link.
	}
	return base ? `[${texte}](${base}${path})` : texte;
}

export async function notifierCompta(evenement: ComptaEvenement, message: string): Promise<boolean> {
	try {
		if (!isMattermostBotConfigured()) return false;
		const [enabled, channel] = await Promise.all([getSetting(COMPTA_EVENEMENTS[evenement].key), getSetting(SETTING_KEYS.comptaChannel)]);
		if (enabled !== 'true' || !channel) return false;
		return await postToChannel(channel, message);
	} catch (err) {
		console.error(`[comptaNotifications] ${evenement} failed:`, err);
		return false;
	}
}
