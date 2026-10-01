// Who may do what to a task, and how a task's status and member list are derived. Pure functions,
// no database and no environment: `+page.server.ts` enforces them, `+page.svelte` decides what to
// show with them, and tests/taskRules.test.ts covers the matrix. Before this module both sides kept
// their own copy of these rules, with a comment on the client's one promising it matched the
// server's.
//
// Admin-ness is passed in as a boolean rather than read from the user: isAdmin() reads
// $env/dynamic/public, which would drag the environment into a module that has no business needing
// it (and that tests could then not import).

import type { Task, TaskMember, TaskStatus } from '$lib/taskTypes';

// --- Derivation -------------------------------------------------------------------------------

// Done when marked so, else blocked when flagged, else "en cours" once someone explicitly started
// it — people being on it isn't enough.
export function deriveStatus(task: {
	doneAt: string | null;
	blocked: unknown | null;
	startedAt: string | null;
}): TaskStatus {
	if (task.doneAt) return 'done';
	if (task.blocked) return 'blocked';
	if (task.startedAt) return 'in_progress';
	return 'todo';
}

// Leader first, then in the order people joined. Sorts a copy: the rows handed in keep their order.
export function sortMembers<T extends { isLeader: boolean }>(members: T[]): T[] {
	return [...members].sort((a, b) => Number(b.isLeader) - Number(a.isLeader));
}

// --- Membership -------------------------------------------------------------------------------

export const isOnTask = (task: Pick<Task, 'members'>, sub: string): boolean =>
	task.members.some((m) => m.sub === sub);

export const isLeader = (task: Pick<Task, 'members'>, sub: string): boolean =>
	task.members.some((m) => m.sub === sub && m.isLeader);

export const membership = (task: Pick<Task, 'members'>, sub: string): TaskMember | undefined =>
	task.members.find((m) => m.sub === sub);

// The task's owner (its author) and its leader manage it alongside admins.
export const isOwnerOrLeader = (task: Pick<Task, 'authorSub' | 'members'>, sub: string): boolean =>
	task.authorSub === sub || isLeader(task, sub);

// --- Permissions ------------------------------------------------------------------------------

// Editing a task's own fields: admins, or whoever created it. Being its leader is not enough —
// the leader runs the work, the author owns the description of it.
export const canEditTask = (task: Pick<Task, 'authorSub'>, sub: string, admin: boolean): boolean =>
	admin || task.authorSub === sub;

// Putting people on a task, and taking them off: admins, the owner or the leader.
export const canAssign = (
	task: Pick<Task, 'authorSub' | 'members'>,
	sub: string,
	admin: boolean
): boolean => admin || isOwnerOrLeader(task, sub);

// Flagging a task blocked or unblocking it: same set as assigning.
export const canFlagBlocked = canAssign;

// Deleting: admins, the owner, or the leader — except the leader of a task an admin created, who
// leads work someone else decided on and doesn't get to make it disappear.
export const canDeleteTask = (
	task: Pick<Task, 'authorSub' | 'members' | 'createdByAdmin'>,
	sub: string,
	admin: boolean
): boolean =>
	admin || task.authorSub === sub || (isLeader(task, sub) && !task.createdByAdmin);

// Starting, stopping, finishing or reopening a task: admins, or anyone actually on it.
export const canProgress = (task: Pick<Task, 'members'>, sub: string, admin: boolean): boolean =>
	admin || isOnTask(task, sub);

// Leaving of one's own accord. Someone an admin put on the task can't refuse it that way; only an
// admin can take them off.
export function canLeave(
	task: Pick<Task, 'members'>,
	sub: string
): { ok: true } | { ok: false; reason: 'not_on_task' | 'imposed' } {
	const me = membership(task, sub);
	if (!me) return { ok: false, reason: 'not_on_task' };
	if (me.imposed) return { ok: false, reason: 'imposed' };
	return { ok: true };
}

// Whether an action is recorded as the member's own or as an admin acting on someone else: being
// the author or on the task makes it the member's own doing.
export const actionSource = (
	task: Pick<Task, 'authorSub' | 'members'>,
	sub: string
): 'user' | 'admin' => (task.authorSub === sub || isOnTask(task, sub) ? 'user' : 'admin');

// --- Board moves ------------------------------------------------------------------------------

// The actions a drag from one column to another runs, in order. A move can need several steps
// (Fait → En cours is reopen, then start). "Bloqué" is never a target here: blocking needs a note,
// so the board opens the task instead of moving it.
export function stepsFor(
	task: { status: TaskStatus; startedAt: string | null; blocked: unknown | null },
	to: Exclude<TaskStatus, 'blocked'>
): string[] {
	const steps: string[] = [];
	if (task.status === 'done') steps.push('reopen');
	if (task.blocked) steps.push('unblock');
	if (to === 'todo' && task.startedAt) steps.push('unstart');
	if (to === 'in_progress' && !task.startedAt) steps.push('start');
	// Marking a task done needs nothing else first: `done` is read before `blocked` and
	// `started_at` when the status is derived.
	if (to === 'done') return ['done'];
	return steps;
}

// --- Misc -------------------------------------------------------------------------------------

// A DATE column comes back as a Date at local midnight; keep only its calendar day, in local time,
// so the day never shifts the way toISOString() would.
export function isoDay(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Passport's public address, for links in Mattermost messages. There's no dedicated setting: the
// OIDC redirect URI always points at Passport itself. null if it isn't configured, or unparsable.
export function publicTaskUrl(taskId: number, redirectUri: string | undefined): string | null {
	try {
		return redirectUri ? `${new URL(redirectUri).origin}/tasks?task=${taskId}` : null;
	} catch {
		return null;
	}
}
