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
	createdByAdmin: boolean;
	priority: number;
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
	priority: number;
}

interface TaskRow {
	id: number;
	created_at: Date;
	author_sub: string;
	author_label: string;
	created_by_admin: boolean;
	priority: number;
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
		createdByAdmin: r.created_by_admin,
		priority: r.priority,
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
		ORDER BY priority DESC, due_date ASC NULLS LAST, id DESC
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

// Whoever creates a task leads it, so it never starts with nobody responsible for it — except
// when an admin creates it: an admin filing tasks on everyone's behalf would end up leading all of
// them, so those stay unled until someone takes them. The two inserts are one transaction: a task
// whose author is its leader must never exist half-created, with the row but not its leader.
export async function createTask(author: Person, input: TaskInput, byAdmin: boolean): Promise<number> {
	const sql = await getDb();
	return await sql.begin(async (tx) => {
		const [row] = await tx<{ id: number }[]>`
			INSERT INTO tasks (author_sub, author_label, title, description, due_date, priority, created_by_admin)
			VALUES (${author.sub}, ${author.label}, ${input.title}, ${input.description}, ${input.dueDate}, ${input.priority}, ${byAdmin})
			RETURNING id
		`;
		if (!byAdmin) {
			// `assigned_by_sub` null: they put themselves on it, like any volunteer — nothing was
			// imposed, so they can still leave, which clears the leader with the row.
			await tx`
				INSERT INTO task_members (task_id, member_sub, member_label, assigned_by_sub, is_leader)
				VALUES (${row.id}, ${author.sub}, ${author.label}, ${null}, true)
			`;
		}
		return row.id;
	});
}

export async function updateTask(id: number, input: TaskInput): Promise<void> {
	const sql = await getDb();
	await sql`
		UPDATE tasks SET title = ${input.title}, description = ${input.description}, due_date = ${input.dueDate},
		       priority = ${input.priority}
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

// Passport's public address, for links in Mattermost messages. There's no dedicated setting: the
// OIDC redirect URI always points at Passport itself. null if it isn't configured.
export function publicTaskUrl(taskId: number, redirectUri: string | undefined): string | null {
	try {
		return redirectUri ? `${new URL(redirectUri).origin}/tasks?task=${taskId}` : null;
	} catch {
		return null;
	}
}

// Dashboard's "Mes tâches": tasks not done that the member is on.
export async function listOpenTasksForMember(memberSub: string): Promise<Task[]> {
	const sql = await getDb();
	const rows = await sql<TaskRow[]>`
		SELECT t.* FROM tasks t
		JOIN task_members m ON m.task_id = t.id AND m.member_sub = ${memberSub}
		WHERE t.done_at IS NULL
		ORDER BY t.priority DESC, t.due_date ASC NULLS LAST, t.id DESC
	`;
	if (rows.length === 0) return [];
	const members = await sql<MemberRow[]>`
		SELECT * FROM task_members WHERE task_id IN ${sql(rows.map((r) => r.id))} ORDER BY joined_at
	`;
	return rows.map((r) => toTask(r, members.filter((m) => m.task_id === r.id)));
}

export interface ReminderCandidate {
	task: Task;
	kind: 'due_soon' | 'overdue';
}

// Tasks owed a reminder today (`today`/`tomorrow` as YYYY-MM-DD in Brussels time): due tomorrow,
// or past their due date, and not reminded yet for that due date.
export async function listReminderCandidates(today: string, tomorrow: string): Promise<ReminderCandidate[]> {
	const sql = await getDb();
	const rows = await sql<(TaskRow & { kind: 'due_soon' | 'overdue' })[]>`
		SELECT *, CASE WHEN due_date = ${tomorrow}::date THEN 'due_soon' ELSE 'overdue' END AS kind
		FROM tasks
		WHERE done_at IS NULL AND blocked_kind IS NULL AND due_date IS NOT NULL AND (
			(due_date = ${tomorrow}::date AND due_soon_reminded_for IS DISTINCT FROM due_date)
			OR (due_date < ${today}::date AND overdue_reminded_for IS DISTINCT FROM due_date)
		)
	`;
	if (rows.length === 0) return [];
	const members = await sql<MemberRow[]>`
		SELECT * FROM task_members WHERE task_id IN ${sql(rows.map((r) => r.id))} ORDER BY joined_at
	`;
	return rows.map((r) => ({ task: toTask(r, members.filter((m) => m.task_id === r.id)), kind: r.kind }));
}

export async function markReminded(taskId: number, kind: 'due_soon' | 'overdue'): Promise<void> {
	const sql = await getDb();
	if (kind === 'due_soon') {
		await sql`UPDATE tasks SET due_soon_reminded_for = due_date WHERE id = ${taskId}`;
	} else {
		await sql`UPDATE tasks SET overdue_reminded_for = due_date WHERE id = ${taskId}`;
	}
}
