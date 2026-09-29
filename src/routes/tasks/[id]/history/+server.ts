import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTaskEvents } from '$lib/server/tasks';

// A task's own history, loaded by its modal on /tasks only when opened — not part of the page
// load, which would fetch every task's history up front. Same audience as the board: any member.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Non connecté.');
	const taskId = Number(params.id);
	if (!Number.isInteger(taskId) || taskId <= 0) error(404, 'Tâche introuvable.');
	return json(await listTaskEvents(taskId));
};
