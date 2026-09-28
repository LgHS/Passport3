// Task priorities, lowest to highest, stored as their `value` (1–5). Shared by the server
// (validation) and the page (labels, colours, sorting).
export const TASK_PRIORITIES = [
	{ value: 1, label: 'Bas', badge: 'bg-gray-100 text-gray-600' },
	{ value: 2, label: 'Moyen', badge: 'bg-gray-200 text-gray-800' },
	{ value: 3, label: 'Normal', badge: 'bg-white text-black' },
	{ value: 4, label: 'Élevé', badge: 'bg-orange-500 text-white' },
	{ value: 5, label: 'Urgent', badge: 'bg-red-600 text-white' }
] as const;

export const DEFAULT_TASK_PRIORITY = 3;

export function priorityMeta(value: number) {
	return TASK_PRIORITIES.find((p) => p.value === value) ?? TASK_PRIORITIES[DEFAULT_TASK_PRIORITY - 1];
}
