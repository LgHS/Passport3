import { getDb } from '$lib/server/db';

// Workshop to-do board — see migrations.ts's migration 10. Phase 1: one-off tasks only (no
// recurrence/rotation yet), one assignee per task.

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Person {
	sub: string;
	label: string;
}

export interface Task {
	id: number;
	createdAt: string;
	authorSub: string;
	authorLabel: string;
	title: string;
	description: string | null;
	dueDate: string | null;
	status: TaskStatus;
	assigneeSub: string | null;
	assigneeLabel: string | null;
	// True when an admin imposed it rather than the assignee volunteering.
	imposed: boolean;
	doneAt: string | null;
}

interface TaskRow {
	id: number;
	created_at: Date;
	author_sub: string;
	author_label: string;
	title: string;
	description: string | null;
	due_date: Date | null;
	status: string;
	assignee_sub: string | null;
	assignee_label: string | null;
	assigned_by_sub: string | null;
	done_at: Date | null;
}

// DATE comes back as a Date at local midnight; keep only its calendar day.
function isoDay(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rowToTask(r: TaskRow): Task {
	return {
		id: r.id,
		createdAt: r.created_at.toISOString(),
		authorSub: r.author_sub,
		authorLabel: r.author_label,
		title: r.title,
		description: r.description,
		dueDate: r.due_date ? isoDay(r.due_date) : null,
		status: r.status as TaskStatus,
		assigneeSub: r.assignee_sub,
		assigneeLabel: r.assignee_label,
		imposed: r.assigned_by_sub !== null,
		doneAt: r.done_at ? r.done_at.toISOString() : null
	};
}

// Done tasks only stay on the board for 30 days, so the "Fait" column doesn't grow forever.
export async function listTasks(): Promise<Task[]> {
	const sql = await getDb();
	const rows = await sql<TaskRow[]>`
		SELECT * FROM tasks
		WHERE status <> 'done' OR done_at > now() - interval '30 days'
		ORDER BY due_date ASC NULLS LAST, id DESC
	`;
	return rows.map(rowToTask);
}

export async function getTask(id: number): Promise<Task | null> {
	const sql = await getDb();
	const [row] = await sql<TaskRow[]>`SELECT * FROM tasks WHERE id = ${id}`;
	return row ? rowToTask(row) : null;
}

export async function createTask(
	author: Person,
	input: { title: string; description: string | null; dueDate: string | null }
): Promise<number> {
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO tasks (author_sub, author_label, title, description, due_date)
		VALUES (${author.sub}, ${author.label}, ${input.title}, ${input.description}, ${input.dueDate})
		RETURNING id
	`;
	return row.id;
}

// `imposedBy` null = the assignee volunteered.
export async function assignTask(id: number, assignee: Person, imposedBy: string | null): Promise<void> {
	const sql = await getDb();
	await sql`
		UPDATE tasks SET assignee_sub = ${assignee.sub}, assignee_label = ${assignee.label},
		       assigned_by_sub = ${imposedBy}, status = 'in_progress', done_at = NULL
		WHERE id = ${id}
	`;
}

export async function unassignTask(id: number): Promise<void> {
	const sql = await getDb();
	await sql`
		UPDATE tasks SET assignee_sub = NULL, assignee_label = NULL, assigned_by_sub = NULL,
		       status = 'todo', done_at = NULL
		WHERE id = ${id}
	`;
}

export async function setTaskDone(id: number, done: boolean): Promise<void> {
	const sql = await getDb();
	if (done) {
		await sql`UPDATE tasks SET status = 'done', done_at = now() WHERE id = ${id}`;
	} else {
		await sql`
			UPDATE tasks SET done_at = NULL,
			       status = CASE WHEN assignee_sub IS NULL THEN 'todo' ELSE 'in_progress' END
			WHERE id = ${id}
		`;
	}
}

export async function deleteTask(id: number): Promise<void> {
	const sql = await getDb();
	await sql`DELETE FROM tasks WHERE id = ${id}`;
}
