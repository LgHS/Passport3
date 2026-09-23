import { getDb } from '$lib/server/db';
import { requireEnv } from '$lib/server/env';
import { getBirthdaySettings } from '$lib/server/birthdaySettings';
import { listBirthdayAnnounceMembers } from '$lib/server/authentikAdmin';
import { lookupMattermostUsername } from '$lib/server/mattermost';
import { postToChannel } from '$lib/server/mattermostBot';

// Hourly is plenty for a once-a-day job — this only needs to catch the configured hour at some
// point during that hour, not hit it exactly on the minute.
const CHECK_INTERVAL_MS = 60 * 60_000;

// {mention} is replaced with an @-mention of the member's Mattermost username. Emoji written as
// Mattermost's `:shortcode:` syntax rather than literal unicode, rendered client-side same as any
// other message.
const MESSAGE_TEMPLATES = [
	'Joyeux anniversaire {mention} ! :tada:',
	'Joyeux anniversaire {mention} ! :birthday:',
	'Joyeux anniversaire {mention} ! :cake: :balloon:',
	'Joyeux anniversaire {mention} ! :confetti_ball: Passe une super journée !',
	'Joyeux anniversaire {mention} ! :gift: Profite bien de ta journée !',
	'Joyeux anniversaire {mention} ! :partying_face: :tada:',
	'Joyeux anniversaire {mention} ! :champagne: Santé et bonheur pour cette nouvelle année !',
	'Joyeux anniversaire {mention} ! :clinking_glasses: On trinque à ta santé !',
	'Joyeux anniversaire {mention} ! :sparkles: Plein de belles choses pour cette nouvelle année !',
	'Joyeux anniversaire {mention} ! :star2: Que cette année soit la meilleure !',
	'Joyeux anniversaire {mention} ! :crown: C’est ta journée, profite !',
	'Joyeux anniversaire {mention} ! :rocket: Une année de plus au compteur, et toujours au top !',
	'Joyeux anniversaire {mention} ! :fireworks: Que la fête commence !',
	'Joyeux anniversaire {mention} ! :sunglasses: Toujours aussi jeune, on ne va pas se mentir !',
	'Joyeux anniversaire {mention} ! :heart: Belle journée à toi !',
	'Joyeux anniversaire {mention} ! :muscle: Encore une année de plus, et toujours en forme !',
	'Joyeux anniversaire {mention} ! :beers: La tournée est pour toi mercredi ?',
	'Joyeux anniversaire {mention} ! :100: Une année parfaite en perspective !'
];

function pickTemplate(): string {
	return MESSAGE_TEMPLATES[Math.floor(Math.random() * MESSAGE_TEMPLATES.length)];
}

// The birthday_sent table itself is created by src/lib/server/migrations.ts (run once from
// db.ts's getDb()) — see that file's migration 2.

function alreadySentThisYear(pk: number, year: number): boolean {
	return !!getDb()
		.prepare('SELECT 1 FROM birthday_sent WHERE member_pk = ? AND year = ?')
		.get(pk, year);
}

function markSent(pk: number, year: number): void {
	getDb().prepare('INSERT OR IGNORE INTO birthday_sent (member_pk, year) VALUES (?, ?)').run(pk, year);
}

// Watchtower redeploys the container on every release, which would reset an in-memory-only "did I
// run this hour" flag — harmless here since `alreadySentThisYear` is the real dedup guard, but
// worth noting this function itself can safely run more than once in the same hour.
function nowInBrussels(): { hour: number; monthDay: string; year: number } {
	try {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Brussels',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			hour12: false
		}).formatToParts(new Date());
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
		return {
			hour: Number(get('hour')),
			monthDay: `${get('month')}-${get('day')}`,
			year: Number(get('year'))
		};
	} catch (err) {
		// Confirmed working in the real node:22-alpine image (docker run --rm node:22-alpine …,
		// 2026-09-22): full ICU is bundled by default, Europe/Brussels resolves correctly. This
		// catch is just a safety net in case a future base image ever strips it, falling back to
		// the container's own clock (UTC, see Dockerfile) rather than crashing the scheduler.
		console.error('[birthdayScheduler] Europe/Brussels timezone unavailable, falling back to UTC:', err);
		const now = new Date();
		return {
			hour: now.getUTCHours(),
			monthDay: `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`,
			year: now.getUTCFullYear()
		};
	}
}

async function checkAndAnnounceBirthdays(): Promise<void> {
	const settings = getBirthdaySettings();
	if (!settings.enabled) return;

	const { hour, monthDay, year } = nowInBrussels();
	// >= rather than === : if Passport3 was down or restarting during the configured hour, the
	// next hourly check still catches up later the same day instead of skipping that birthday for
	// the whole year. alreadySentThisYear() is what actually prevents duplicates.
	if (hour < settings.hour) return;

	const channelId = requireEnv('MATTERMOST_BIRTHDAY_CHANNEL_ID');
	const members = await listBirthdayAnnounceMembers();

	for (const member of members) {
		// `birthday` is "MM-DD" or "YYYY-MM-DD" — the last 5 characters are always "MM-DD" either way.
		if (member.birthday.slice(-5) !== monthDay) continue;
		if (alreadySentThisYear(member.pk, year)) continue;

		const mattermost = await lookupMattermostUsername(member.email);
		if (!mattermost.username) continue; // no linked account, nothing to @-mention

		const message = pickTemplate().replace('{mention}', `@${mattermost.username}`);
		const sent = await postToChannel(channelId, message);
		if (sent) markSent(member.pk, year);
	}
}

let intervalStarted = false;

// Called once from hooks.server.ts's module scope (not per-request) — safe to call more than
// once regardless, the guard just avoids stacking up duplicate intervals if it ever is.
export function startBirthdayScheduler(): void {
	if (intervalStarted) return;
	intervalStarted = true;

	checkAndAnnounceBirthdays().catch((err) =>
		console.error('[birthdayScheduler] initial check failed:', err)
	);
	setInterval(() => {
		checkAndAnnounceBirthdays().catch((err) => console.error('[birthdayScheduler] check failed:', err));
	}, CHECK_INTERVAL_MS);
}
