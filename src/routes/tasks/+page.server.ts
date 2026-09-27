import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { assignTask, createTask, deleteTask, getTask, listTasks, setTaskDone, unassignTask } from '$lib/server/tasks';
import { listUsers } from '$lib/server/authentikAdmin';
import { getMattermostUsername } from '$lib/server/mattermost';
import { postDirectMessage } from '$lib/server/mattermostBot';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, isAdmin, type AppUser } from '$lib/types';

const TITLE_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 2000;

function requireUser(locals: App.Locals): AppUser {
	if (!locals.user) redirect(302, '/login');
	return locals.user;
}

// Same label convention as the wishlist: the Authentik username.
function usernameLabel(user: AppUser): string {
	return user.preferred_username ?? displayName(user);
}

// Subject mode makes sub the Authentik pk (see authentikPk() in $lib/types).
function targetFromSub(sub: string): { pk: number } | Record<string, never> {
	const pk = Number(sub);
	return Number.isInteger(pk) && pk > 0 ? { pk } : {};
}

function taskIdFrom(formData: FormData): number | null {
	const id = Number(formData.get('taskId'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const admin = isAdmin(user);
	const [tasks, members] = await Promise.all([
		listTasks(),
		// Admins only: the list of members they can assign a task to. Best-effort — the board
		// still works without it, just without the assignment picker.
		admin
			? listUsers()
					.then((users) =>
						users.filter((u) => u.is_active).map((u) => ({ sub: String(u.pk), label: u.username }))
					)
					.catch(() => null)
			: Promise.resolve(null)
	]);
	return { tasks, members, isAdmin: admin, mySub: user.sub };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const title = String(formData.get('title') ?? '').trim();
		const description = String(formData.get('description') ?? '').trim();
		const dueDate = String(formData.get('dueDate') ?? '').trim();

		if (!title) return fail(400, { error: 'Le titre est obligatoire.' });
		if (title.length > TITLE_MAX_LENGTH) return fail(400, { error: `Titre : ${TITLE_MAX_LENGTH} caractères maximum.` });
		if (description.length > DESCRIPTION_MAX_LENGTH) {
			return fail(400, { error: `Description : ${DESCRIPTION_MAX_LENGTH} caractères maximum.` });
		}
		if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail(400, { error: 'Date invalide.' });

		const taskId = await createTask(
			{ sub: user.sub, label: usernameLabel(user) },
			{ title, description: description || null, dueDate: dueDate || null }
		);
		await logAuditEvent({ sub: user.sub, label: displayName(user) }, 'user', 'task.create', targetFromSub(user.sub), {
			taskId,
			title
		});
		return { created: true };
	},

	// A member volunteers for an unassigned task.
	take: async ({ request, locals }) => {
		const user = requireUser(locals);
		const taskId = taskIdFrom(await request.formData());
		const task = taskId ? await getTask(taskId) : null;
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (task.status !== 'todo' || task.assigneeSub) return fail(409, { error: 'Cette tâche est déjà prise.' });

		await assignTask(task.id, { sub: user.sub, label: usernameLabel(user) }, null);
		await logAuditEvent({ sub: user.sub, label: displayName(user) }, 'user', 'task.take', targetFromSub(user.sub), {
			taskId: task.id,
			title: task.title
		});
		return { updated: true };
	},

	// A volunteer gives a task back. Not possible for an imposed task — only an admin can undo that.
	release: async ({ request, locals }) => {
		const user = requireUser(locals);
		const taskId = taskIdFrom(await request.formData());
		const task = taskId ? await getTask(taskId) : null;
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		const admin = isAdmin(user);
		const ownVolunteered = task.assigneeSub === user.sub && !task.imposed;
		if (!admin && !ownVolunteered) {
			return fail(403, { error: 'Une tâche assignée par un admin ne peut pas être refusée.' });
		}

		await unassignTask(task.id);
		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			ownVolunteered ? 'user' : 'admin',
			'task.release',
			targetFromSub(task.assigneeSub ?? user.sub),
			{ taskId: task.id, title: task.title }
		);
		return { updated: true };
	},

	// Admin only: imposes a task on a member, and tells them on Mattermost (best-effort).
	assign: async ({ request, locals }) => {
		const user = requireUser(locals);
		if (!isAdmin(user)) return fail(403, { error: 'Réservé aux administrateurs.' });
		const formData = await request.formData();
		const taskId = taskIdFrom(formData);
		const assigneePk = Number(formData.get('assigneePk'));
		const task = taskId ? await getTask(taskId) : null;
		if (!task) return fail(404, { error: 'Tâche introuvable.' });

		const member = (await listUsers()).find((u) => u.pk === assigneePk && u.is_active);
		if (!member) return fail(400, { error: 'Membre introuvable.' });

		await assignTask(task.id, { sub: String(member.pk), label: member.username }, user.sub);
		await logAuditEvent({ sub: user.sub, label: displayName(user) }, 'admin', 'task.assign', { pk: member.pk }, {
			taskId: task.id,
			title: task.title
		});

		const mattermostUsername = member.email ? await getMattermostUsername(member.email).catch(() => null) : null;
		if (mattermostUsername) {
			await postDirectMessage(
				mattermostUsername,
				`📌 ${usernameLabel(user)} t'a assigné une tâche dans Passport : **${task.title}**${task.dueDate ? ` (pour le ${task.dueDate})` : ''}.`
			);
		}
		return { updated: true };
	},

	done: async ({ request, locals }) => {
		const user = requireUser(locals);
		const taskId = taskIdFrom(await request.formData());
		const task = taskId ? await getTask(taskId) : null;
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		const admin = isAdmin(user);
		if (!admin && task.assigneeSub !== user.sub) {
			return fail(403, { error: 'Seule la personne en charge peut marquer cette tâche comme faite.' });
		}

		await setTaskDone(task.id, true);
		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			task.assigneeSub === user.sub ? 'user' : 'admin',
			'task.done',
			targetFromSub(task.assigneeSub ?? user.sub),
			{ taskId: task.id, title: task.title }
		);
		return { updated: true };
	},

	reopen: async ({ request, locals }) => {
		const user = requireUser(locals);
		const taskId = taskIdFrom(await request.formData());
		const task = taskId ? await getTask(taskId) : null;
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		if (!isAdmin(user) && task.assigneeSub !== user.sub) return fail(403, { error: 'Action non autorisée.' });

		await setTaskDone(task.id, false);
		return { updated: true };
	},

	// Admins, or the author while nobody has taken it yet.
	delete: async ({ request, locals }) => {
		const user = requireUser(locals);
		const taskId = taskIdFrom(await request.formData());
		const task = taskId ? await getTask(taskId) : null;
		if (!task) return fail(404, { error: 'Tâche introuvable.' });
		const admin = isAdmin(user);
		if (!admin && !(task.authorSub === user.sub && !task.assigneeSub)) {
			return fail(403, { error: 'Vous ne pouvez plus supprimer cette tâche.' });
		}

		await deleteTask(task.id);
		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			task.authorSub === user.sub ? 'user' : 'admin',
			'task.delete',
			targetFromSub(task.authorSub),
			{ taskId: task.id, title: task.title }
		);
		return { deleted: true };
	}
};
