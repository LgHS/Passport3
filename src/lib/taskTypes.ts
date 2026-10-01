// Shapes of the to-do board's data. Here rather than in $lib/server/tasks.ts so that $lib/taskRules
// and the page can use them: client code may never import from $lib/server. `tasks.ts` re-exports
// all of them, so `import type { Task } from '$lib/server/tasks'` keeps working.

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
	// Derived by deriveStatus() in $lib/taskRules, never stored.
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
