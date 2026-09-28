import { getDb } from '$lib/server/db';

// Workshop to-do board — see migrations.ts's migration 10. One-off tasks only for now (no
// recurrence/rotation yet). A task can have several people on it, one of them its leader.

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type BlockedKind = 'internal' | 'external';

export interface Person {
	sub: string;
	label: string;
}

export interface TaskMember extends Person {
	// True when an admin put them on the task rather than them volunteering.
	imposed: boolean;
	isLeader: boolean;
}

export interface Task {
	id: number;
	createdAt: string;
	authorSub: string;
	authorLabel: string;
	title: string;
	description: string | null;
	dueDate: string | null;
	// Derived: done when marked so, else blocked when flagged, else "en cours" once someone
	// explicitly started it — people being on it isn't enough.
	status: TaskStatus;
	startedAt: string | null;
	blocked: { kind: BlockedKind; note: string } | null;
	members: TaskMember[];
	doneAt: string | null;
}

export interface TaskInput {
	title: string;
	description: string | null;
	dueDate: string | null;
}

interface TaskRow {
	id: number;
	created_at: Date;
	author_sub: string;
	author_label: string;
	title: string;
	description: string | null;
	due_date: Date | null;
	done_at: Date | null;
	started_at: Date | null;
	blocked_kind: string | null;
	blocked_note: string | null;
}

interface MemberRow {
	task_id: number;
	member_sub: string;
	member_label: string;
	assigned_by_sub: string | null;
	is_leader: boolean;
}

// DATE comes back as a Date at local midnight; keep only its calendar day.
function isoDay(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toTask(r: TaskRow, memberRows: MemberRow[]): Task {
	const members = memberRows.map((m) => ({
		sub: m.member_sub,
		label: m.member_label,
		imposed: m.assigned_by_sub !== null,
		isLeader: m.is_leader
	}));
	return {
		id: r.id,
		createdAt: r.created_at.toISOString(),
		authorSub: r.author_sub,
		authorLabel: r.author_label,
		title: r.title,
		description: r.description,
		dueDate: r.due_date ? isoDay(r.due_date) : null,
		status: r.done_at ? 'done' : r.blocked_kind ? 'blocked' : r.started_at ? 'in_progress' : 'todo',
		startedAt: r.started_at ? r.started_at.toISOString() : null,
		blocked: r.blocked_kind
			? { kind: r.blocked_kind as BlockedKind, note: r.blocked_note ?? '' }
			: null,
		// Leader first, then in the order people joined.
		members: members.sort((a, b) => Number(b.isLeader) - Number(a.isLeader)),
		doneAt: r.done_at ? r.done_at.toISOString() : null
	};
}

// Done tasks only stay on the board for 30 days, so the "Fait" column doesn't grow forever.
// Two queries (tasks, then all their members), not one per task.
export async function listTasks(): Promise<Task[]> {
	const sql = await getDb();
	const rows = await sql<TaskRow[]>`
		SELECT * FROM tasks
		WHERE done_at IS NULL OR done_at > now() - interval '30 days'
		ORDER BY due_date ASC NULLS LAST, id DESC
	`;
	if (rows.length === 0) return [];
	const members = await sql<MemberRow[]>`
		SELECT * FROM task_members WHERE task_id IN ${sql(rows.map((r) => r.id))} ORDER BY joined_at
	`;
	return rows.map((r) => toTask(r, members.filter((m) => m.task_id === r.id)));
}

export async function getTask(id: number): Promise<Task | null> {
	const sql = await getDb();
	const [row] = await sql<TaskRow[]>`SELECT * FROM tasks WHERE id = ${id}`;
	if (!row) return null;
	const members = await sql<MemberRow[]>`SELECT * FROM task_members WHERE task_id = ${id} ORDER BY joined_at`;
	return toTask(row, members);
}

export async function createTask(author: Person, input: TaskInput): Promise<number> {
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO tasks (author_sub, author_label, title, description, due_date)
		VALUES (${author.sub}, ${author.label}, ${input.title}, ${input.description}, ${input.dueDate})
		RETURNING id
	`;
	return row.id;
}

export async function updateTask(id: number, input: TaskInput): Promise<void> {
	const sql = await getDb();
	await sql`
		UPDATE tasks SET title = ${input.title}, description = ${input.description}, due_date = ${input.dueDate}
		WHERE id = ${id}
	`;
}

// `imposedBy` null = the member volunteered. Already on the task: an admin assigning them turns a
// volunteer into an imposed member; volunteering again changes nothing.
export async function addTaskMember(id: number, member: Person, imposedBy: string | null): Promise<void> {
	const sql = await getDb();
	await sql`
		INSERT INTO task_members (task_id, member_sub, member_label, assigned_by_sub)
		VALUES (${id}, ${member.sub}, ${member.label}, ${imposedBy})
		ON CONFLICT (task_id, member_sub) DO UPDATE
		SET assigned_by_sub = COALESCE(EXCLUDED.assigned_by_sub, task_members.assigned_by_sub)
	`;
}

export async function removeTaskMember(id: number, memberSub: string): Promise<void> {
	const sql = await getDb();
	await sql`DELETE FROM task_members WHERE task_id = ${id} AND member_sub = ${memberSub}`;
}

// `leaderSub` null clears the leader. Must be someone already on the task.
export async function setTaskLeader(id: number, leaderSub: string | null): Promise<void> {
	const sql = await getDb();
	await sql.begin(async (tx) => {
		await tx`UPDATE task_members SET is_leader = false WHERE task_id = ${id} AND is_leader`;
		if (leaderSub) {
			await tx`UPDATE task_members SET is_leader = true WHERE task_id = ${id} AND member_sub = ${leaderSub}`;
		}
	});
}

export async function setTaskDone(id: number, done: boolean): Promise<void> {
	const sql = await getDb();
	await sql`UPDATE tasks SET done_at = ${done ? new Date() : null} WHERE id = ${id}`;
}

export async function setTaskStarted(id: number, started: boolean): Promise<void> {
	const sql = await getDb();
	await sql`UPDATE tasks SET started_at = ${started ? new Date() : null} WHERE id = ${id}`;
}

// `blocked` null unblocks the task.
export async function setTaskBlocked(
	id: number,
	blocked: { kind: BlockedKind; note: string } | null
): Promise<void> {
	const sql = await getDb();
	await sql`
		UPDATE tasks SET blocked_kind = ${blocked?.kind ?? null}, blocked_note = ${blocked?.note ?? null}
		WHERE id = ${id}
	`;
}

export async function deleteTask(id: number): Promise<void> {
	const sql = await getDb();
	await sql`DELETE FROM tasks WHERE id = ${id}`;
}

export interface TaskEvent {
	id: number;
	createdAt: string;
	actorLabel: string;
	action: string;
	details: Record<string, unknown> | null;
}

// Best-effort, like logAuditEvent: a history entry that fails to write never fails the action.
export async function addTaskEvent(
	taskId: number,
	actorLabel: string,
	action: string,
	details: Record<string, unknown>
): Promise<void> {
	try {
		const sql = await getDb();
		await sql`
			INSERT INTO task_events (task_id, actor_label, action, details)
			VALUES (${taskId}, ${actorLabel}, ${action}, ${JSON.stringify(details)})
		`;
	} catch (err) {
		console.error('Failed to write task event', err);
	}
}

export async function listTaskEvents(taskId: number): Promise<TaskEvent[]> {
	const sql = await getDb();
	const rows = await sql<
		{ id: number; created_at: Date; actor_label: string; action: string; details: string | null }[]
	>`SELECT id, created_at, actor_label, action, details FROM task_events WHERE task_id = ${taskId} ORDER BY id`;
	return rows.map((r) => {
		let details: Record<string, unknown> | null = null;
		try {
			details = r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null;
		} catch {
			details = null;
		}
		return { id: r.id, createdAt: r.created_at.toISOString(), actorLabel: r.actor_label, action: r.action, details };
	});
}
