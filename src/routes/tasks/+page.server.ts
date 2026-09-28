import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	addTaskMember,
	createTask,
	deleteTask,
	getTask,
	listTasks,
	removeTaskMember,
	addTaskEvent,
	setTaskBlocked,
	setTaskStarted,
	setTaskDone,
	setTaskLeader,
	updateTask,
	type Task,
	type TaskInput
} from '$lib/server/tasks';
import { listUsers } from '$lib/server/authentikAdmin';
import { getMattermostUsername } from '$lib/server/mattermost';
import { postDirectMessage } from '$lib/server/mattermostBot';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, isAdmin, type AppUser } from '$lib/types';

const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 2000;
const BLOCKED_NOTE_MAX_LENGTH = 500;

function requireUser(locals: App.Locals): AppUser {
	if (!locals.user) redirect(302, '/login');
	return locals.user;
}

// Same label convention as the wishlist: the Authentik username.
function usernameLabel(user: AppUser): string {
	return user.preferred_username ?? displayName(user);
}

function actor(user: AppUser) {
	return { sub: user.sub, label: displayName(user) };
}

// Subject mode makes sub the Authentik pk (see authentikPk() in $lib/types).
function targetFromSub(sub: string): { pk: number } | Record<string, never> {
	const pk = Number(sub);
	return Number.isInteger(pk) && pk > 0 ? { pk } : {};
}

async function taskFrom(formData: FormData): Promise<Task | null> {
	const id = Number(formData.get('taskId'));
	return Number.isInteger(id) && id > 0 ? getTask(id) : null;
}

function validateTaskInput(formData: FormData): { ok: true; input: TaskInput } | { ok: false; error: string } {
	const title = String(formData.get('title') ?? '').trim();
	const description = String(formData.get('description') ?? '').trim();
	const dueDate = String(formData.get('dueDate') ?? '').trim();
	if (!title) return { ok: false, error: 'Le titre est obligatoire.' };
	if (title.length > TITLE_MAX_LENGTH) return { ok: false, error: `Titre : ${TITLE_MAX_LENGTH} caractères maximum.` };
	if (description.length > DESCRIPTION_MAX_LENGTH) {
		return { ok: false, error: `Description : ${DESCRIPTION_MAX_LENGTH} caractères maximum.` };
	}
	if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, error: 'Date limite invalide.' };
	return { ok: true, input: { title, description: description || null, dueDate: dueDate || null } };
}

const isOnTask = (task: Task, sub: string) => task.members.some((m) => m.sub === sub);

// Blocking/unblocking: anyone on the task, its author, or an admin.
const canFlagBlocked = (task: Task, user: AppUser) =>
	isAdmin(user) || task.authorSub === user.sub || isOnTask(task, user.sub);

// Every task action is recorded twice: in the audit log, with the member concerned as its target
// (so it shows in /admin/audit and in that member's own "Historique" on /profile), and in the
// task's own history (task_events, shown in its modal).
async function record(
	user: AppUser,
	source: 'user' | 'admin',
	action: string,
	target: { pk: number } | Record<string, never>,
	taskId: number,
	details: Record<string, unknown>
): Promise<void> {
	await logAuditEvent(actor(user), source, action, target, { taskId, ...details });
	// A deleted task has no history left to add to (task_events goes with it).
	if (action !== 'task.delete') await addTaskEvent(taskId, usernameLabel(user), action, details);
}

function sourceFor(task: Task, user: AppUser): 'user' | 'admin' {
	return task.authorSub === user.sub || isOnTask(task, user.sub) ? 'user' : 'admin';
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const admin = isAdmin(user);
	const [tasks, members] = await Promise.all([
		listTasks(),
		// Admins only: the members they can put on a task. Best-effort — the board still works
		// without it, just without the assignment picker.
		admin
			? listUsers()
					.then((users) =>
						users
							.filter((u) => u.is_active)
							.map((u) => ({ pk: u.pk, label: u.username }))
							.sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
					)
					.catch(() => null)
			: Promise.resolve(null)
	]);
	return { tasks, members, isAdmin: admin, mySub: user.sub };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		const result = validateTaskInput(await request.formData());
		if (!result.ok) return fail(400, { error: result.error });

		const taskId = await createTask({ sub: user.sub, label: usernameLabel(user) }, result.input);
		await record(user, 'user', 'task.create', targetFromSub(user.sub), taskId, {
			title: result.input.title
		});
		return { created: true };
	},

	// Admins, or the author.
	edit: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const task = await taskFrom(formData);
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && task.authorSub !== user.sub) return fail(403, { error: 'Action non autorisée.' });
		const result = validateTaskInput(formData);
		if (!result.ok) return fail(400, { error: result.error });

		await updateTask(task.id, result.input);
		await record(user, task.authorSub === user.sub ? 'user' : 'admin', 'task.edit', targetFromSub(task.authorSub), task.id, {
				before: { title: task.title, description: task.description, dueDate: task.dueDate },
				after: result.input
			}
		);
		return { edited: true };
	},

	// Any member can volunteer, several people can be on the same task.
	join: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (task.status === 'done') return fail(409, { error: 'Cette tâche est déjà faite.' });

		await addTaskMember(task.id, { sub: user.sub, label: usernameLabel(user) }, null);
		await record(user, 'user', 'task.join', targetFromSub(user.sub), task.id, {
			title: task.title
		});
		return { updated: true };
	},

	// A volunteer leaves. Someone an admin put on the task can't — only an admin can remove them.
	leave: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		const me = task.members.find((m) => m.sub === user.sub);
		if (!me) return fail(400, { error: "Vous n'êtes pas sur cette tâche." });
		if (me.imposed) return fail(403, { error: 'Une tâche assignée par un admin ne peut pas être refusée.' });

		await removeTaskMember(task.id, user.sub);
		await record(user, 'user', 'task.leave', targetFromSub(user.sub), task.id, {
			title: task.title
		});
		return { updated: true };
	},

	// Admin only: puts one or more members on a task, and tells each newly added one on
	// Mattermost (best-effort).
	assign: async ({ request, locals }) => {
		const user = requireUser(locals);
		if (!isAdmin(user)) return fail(403, { error: 'Réservé aux administrateurs.' });
		const formData = await request.formData();
		const task = await taskFrom(formData);
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		const pks = new Set(formData.getAll('assigneePk').map(Number));
		if (pks.size === 0) return fail(400, { error: 'Choisissez au moins un membre.' });

		const chosen = (await listUsers()).filter((u) => u.is_active && pks.has(u.pk));
		for (const member of chosen) {
			const sub = String(member.pk);
			const alreadyOn = isOnTask(task, sub);
			await addTaskMember(task.id, { sub, label: member.username }, user.sub);
			await record(user, 'admin', 'task.assign', { pk: member.pk }, task.id, {
				member: member.username,
				title: task.title
			});
			if (alreadyOn || !member.email) continue;
			const mattermostUsername = await getMattermostUsername(member.email).catch(() => null);
			if (mattermostUsername) {
				await postDirectMessage(
					mattermostUsername,
					`📌 ${usernameLabel(user)} t'a assigné une tâche dans Passport : **${task.title}**${task.dueDate ? ` (date limite : ${task.dueDate})` : ''}.`
				);
			}
		}
		return { updated: true };
	},

	// Admin only: takes someone off a task, imposed or not.
	removeMember: async ({ request, locals }) => {
		const user = requireUser(locals);
		if (!isAdmin(user)) return fail(403, { error: 'Réservé aux administrateurs.' });
		const formData = await request.formData();
		const task = await taskFrom(formData);
		const memberSub = String(formData.get('memberSub') ?? '');
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isOnTask(task, memberSub)) return fail(400, { error: "Ce membre n'est pas sur cette tâche." });

		await removeTaskMember(task.id, memberSub);
		await record(user, 'admin', 'task.removeMember', targetFromSub(memberSub), task.id, {
				member: task.members.find((m) => m.sub === memberSub)?.label,
			title: task.title
		});
		return { updated: true };
	},

	// Admins or the author pick the leader among the people on the task (empty = no leader).
	setLeader: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const task = await taskFrom(formData);
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && task.authorSub !== user.sub) return fail(403, { error: 'Action non autorisée.' });
		const leaderSub = String(formData.get('leaderSub') ?? '') || null;
		if (leaderSub && !isOnTask(task, leaderSub)) {
			return fail(400, { error: 'Le leader doit faire partie des personnes sur la tâche.' });
		}

		await setTaskLeader(task.id, leaderSub);
		await record(user, task.authorSub === user.sub ? 'user' : 'admin', 'task.setLeader', leaderSub ? targetFromSub(leaderSub) : targetFromSub(task.authorSub), task.id, { title: task.title, leader: task.members.find((m) => m.sub === leaderSub)?.label ?? null }
		);
		return { updated: true };
	},

	// Anyone on the task, or an admin.
	done: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && !isOnTask(task, user.sub)) {
			return fail(403, { error: 'Seules les personnes sur la tâche peuvent la marquer comme faite.' });
		}

		await setTaskDone(task.id, true);
		await record(user, isOnTask(task, user.sub) ? 'user' : 'admin', 'task.done', targetFromSub(user.sub), task.id, { title: task.title }
		);
		return { updated: true };
	},

	reopen: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && !isOnTask(task, user.sub)) return fail(403, { error: 'Action non autorisée.' });

		await setTaskDone(task.id, false);
		await record(user, sourceFor(task, user), 'task.reopen', targetFromSub(user.sub), task.id, {
			title: task.title
		});
		return { updated: true };
	},

	// "Démarrer": people being on a task doesn't mean it has started. Anyone on it, or an admin.
	start: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && !isOnTask(task, user.sub)) {
			return fail(403, { error: 'Seules les personnes sur la tâche peuvent la démarrer.' });
		}
		if (task.status === 'done') return fail(409, { error: 'Cette tâche est déjà faite.' });

		await setTaskStarted(task.id, true);
		await record(user, sourceFor(task, user), 'task.start', targetFromSub(user.sub), task.id, { title: task.title });
		return { updated: true };
	},

	// Back to "à faire" (e.g. started by mistake), people stay on it.
	unstart: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && !isOnTask(task, user.sub)) return fail(403, { error: 'Action non autorisée.' });

		await setTaskStarted(task.id, false);
		await record(user, sourceFor(task, user), 'task.unstart', targetFromSub(user.sub), task.id, { title: task.title });
		return { updated: true };
	},

	block: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const task = await taskFrom(formData);
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!canFlagBlocked(task, user)) return fail(403, { error: 'Action non autorisée.' });
		const kind = String(formData.get('blockedKind') ?? '');
		const note = String(formData.get('blockedNote') ?? '').trim();
		if (kind !== 'internal' && kind !== 'external') return fail(400, { error: 'Type de blocage invalide.' });
		if (!note) return fail(400, { error: 'Précisez ce qui bloque la tâche.' });
		if (note.length > BLOCKED_NOTE_MAX_LENGTH) {
			return fail(400, { error: `Note : ${BLOCKED_NOTE_MAX_LENGTH} caractères maximum.` });
		}

		await setTaskBlocked(task.id, { kind, note });
		await record(user, sourceFor(task, user), 'task.block', targetFromSub(task.authorSub), task.id, {
			title: task.title,
			before: task.blocked,
			after: { kind, note }
		});
		return { updated: true };
	},

	unblock: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!canFlagBlocked(task, user)) return fail(403, { error: 'Action non autorisée.' });

		await setTaskBlocked(task.id, null);
		await record(user, sourceFor(task, user), 'task.unblock', targetFromSub(task.authorSub), task.id, {
			title: task.title,
			before: task.blocked
		});
		return { updated: true };
	},

	// Admins, or the author while nobody is on it yet.
	delete: async ({ request, locals }) => {
		const user = requireUser(locals);
		const task = await taskFrom(await request.formData());
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && !(task.authorSub === user.sub && task.members.length === 0)) {
			return fail(403, { error: 'Vous ne pouvez plus supprimer cette tâche.' });
		}

		await deleteTask(task.id);
		await record(user, task.authorSub === user.sub ? 'user' : 'admin', 'task.delete', targetFromSub(task.authorSub), task.id, { title: task.title }
		);
		return { deleted: true };
	}
};
