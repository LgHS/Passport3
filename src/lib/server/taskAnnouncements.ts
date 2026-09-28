import { env } from '$env/dynamic/private';
import { getSetting, setSetting, SETTING_KEYS, type SettingKey } from '$lib/server/appSettings';
import { postToChannel } from '$lib/server/mattermostBot';
import { listTasks, publicTaskUrl, type Task } from '$lib/server/tasks';

// Task board posts to the Mattermost channel chosen on /admin/settings, each kind behind its own
// switch (all off by default). Best-effort like the wishlist's: postToChannel never throws, and
// a settings read failing just skips the post — the task action itself already succeeded.

export type TaskAnnouncement = 'created' | 'done' | 'blocked' | 'urgent';

const SWITCHES: Record<TaskAnnouncement, SettingKey> = {
	created: SETTING_KEYS.tasksAnnounceCreated,
	done: SETTING_KEYS.tasksAnnounceDone,
	blocked: SETTING_KEYS.tasksAnnounceBlocked,
	urgent: SETTING_KEYS.tasksAnnounceUrgent
};

// The channel, when this switch is on and a channel is set.
async function channelFor(key: SettingKey): Promise<string | null> {
	const [enabled, channelId] = await Promise.all([
		getSetting(key).catch(() => null),
		getSetting(SETTING_KEYS.tasksChannel).catch(() => null)
	]);
	return enabled === 'true' && channelId ? channelId : null;
}

function withLink(text: string, taskId: number): string {
	const link = publicTaskUrl(taskId, env.AUTHENTIK_REDIRECT_URI);
	return link ? `${text} ${link}` : text;
}

const mentions = (task: Pick<Task, 'members'>) => task.members.map((m) => `@${m.label}`).join(', ');

export async function announceTask(
	event: TaskAnnouncement,
	task: Pick<Task, 'id' | 'title' | 'members'> & { blockedNote?: string },
	actorUsername: string
): Promise<void> {
	const channelId = await channelFor(SWITCHES[event]);
	if (!channelId) return;
	const title = `**${task.title}**`;
	const text = {
		created: `🆕 Nouvelle tâche : ${title}, proposée par @${actorUsername}. Avis aux volontaires !`,
		done: `✅ Tâche terminée : ${title}. Merci ${task.members.length > 0 ? mentions(task) : `@${actorUsername}`} !`,
		blocked: `🚧 Tâche bloquée : ${title}${task.blockedNote ? ` — ${task.blockedNote}` : ''}. Un coup de main ?`,
		urgent: `🔥 Tâche urgente : ${title}${task.members.length > 0 ? ` (sur la tâche : ${mentions(task)})` : ", personne dessus pour l'instant"}.`
	}[event];
	await postToChannel(channelId, withLink(text, task.id));
}

// Monday from `hour` (Brussels) on, once a week: overdue tasks and tasks nobody is on. Called from
// the task reminder scheduler's hourly check. Nothing to report sends nothing.
export async function sendWeeklyTaskRecap(today: string, hour: number, recapHour: number): Promise<void> {
	if (hour < recapHour || new Date(`${today}T12:00:00Z`).getUTCDay() !== 1) return;
	const channelId = await channelFor(SETTING_KEYS.tasksWeeklyRecap);
	if (!channelId) return;
	if ((await getSetting(SETTING_KEYS.tasksRecapLastSent)) === today) return;

	const open = (await listTasks()).filter((t) => t.status !== 'done');
	const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
	const unstaffed = open.filter((t) => t.members.length === 0 && t.status !== 'blocked');
	const line = (t: Task) => `- ${withLink(`**${t.title}**${t.dueDate ? ` (${t.dueDate})` : ''}`, t.id)}`;

	const sections: string[] = [];
	if (overdue.length > 0) sections.push(`**En retard**\n${overdue.map(line).join('\n')}`);
	if (unstaffed.length > 0) sections.push(`**Sans participant**\n${unstaffed.map(line).join('\n')}`);
	if (sections.length > 0) {
		await postToChannel(channelId, `📋 Récap de la semaine des tâches\n\n${sections.join('\n\n')}`);
	}
	// Marked even when there was nothing to say, so the check stops for the week.
	await setSetting(SETTING_KEYS.tasksRecapLastSent, today);
}
