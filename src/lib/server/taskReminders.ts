import { env } from '$env/dynamic/private';
import { listUsers } from '$lib/server/authentikAdmin';
import { getMattermostUsername } from '$lib/server/mattermost';
import { postDirectMessage } from '$lib/server/mattermostBot';
import { addTaskEvent, listReminderCandidates, markReminded, publicTaskUrl } from '$lib/server/tasks';
import { sendWeeklyTaskRecap } from '$lib/server/taskAnnouncements';

// Mattermost reminders for the task board, same shape as birthdayScheduler.ts: an hourly check,
// sending from REMINDER_HOUR (Brussels time) on. Each task gets one "due tomorrow" and one
// "overdue" reminder per due date (see migration 15), sent to everyone on it, or to its owner when
// nobody is. Blocked tasks are left alone: they're waiting on something else.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_HOUR = 9;

function brusselsDate(offsetDays = 0): { day: string; hour: number } {
	const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
	try {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Brussels',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			hour12: false
		}).formatToParts(date);
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
		return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
	} catch {
		return { day: date.toISOString().slice(0, 10), hour: date.getUTCHours() };
	}
}

async function sendTaskReminders(): Promise<void> {
	const now = brusselsDate();
	// The weekly recap on the task channel has its own day and hour (Paramètres admin).
	await sendWeeklyTaskRecap(now.day, now.hour).catch((err) =>
		console.error('[taskReminders] weekly recap failed:', err)
	);
	if (now.hour < REMINDER_HOUR) return;
	const candidates = await listReminderCandidates(now.day, brusselsDate(1).day);
	if (candidates.length === 0) return;

	// One Authentik call for every recipient's email (task members are stored by Authentik pk).
	const emailByPk = new Map((await listUsers()).map((u) => [String(u.pk), u.email]));

	for (const { task, kind } of candidates) {
		const recipients = task.members.length > 0 ? task.members.map((m) => m.sub) : [task.authorSub];
		const link = publicTaskUrl(task.id, env.AUTHENTIK_REDIRECT_URI);
		const text =
			kind === 'due_soon'
				? `⏰ Rappel : la tâche **${task.title}** est à faire pour demain.`
				: `🚨 La tâche **${task.title}** a dépassé sa date limite (${task.dueDate}).`;
		for (const sub of recipients) {
			const email = emailByPk.get(sub);
			const username = email ? await getMattermostUsername(email).catch(() => null) : null;
			if (username) await postDirectMessage(username, link ? `${text} ${link}` : text);
		}
		// Marked even if a DM failed: better one missed reminder than one every hour.
		await markReminded(task.id, kind);
		await addTaskEvent(task.id, 'Passport', kind === 'due_soon' ? 'task.remindDueSoon' : 'task.remindOverdue', {});
	}
}

let intervalStarted = false;

// Called once from hooks.server.ts's module scope, like startBirthdayScheduler().
export function startTaskReminderScheduler(): void {
	if (intervalStarted) return;
	intervalStarted = true;
	sendTaskReminders().catch((err) => console.error('[taskReminders] initial check failed:', err));
	setInterval(() => {
		sendTaskReminders().catch((err) => console.error('[taskReminders] check failed:', err));
	}, CHECK_INTERVAL_MS);
}
