// Shared reactive toast state (Svelte 5 runes work outside .svelte files in a .svelte.ts module).
// Any page calls showToast() — a single <Toast /> instance in the root layout renders it, so no
// page needs its own copy of this state/logic.

export type ToastType = 'success' | 'error';

interface ToastState {
	type: ToastType;
	message: string;
}

let current = $state<ToastState | null>(null);
let dismissTimeout: ReturnType<typeof setTimeout> | undefined;

const DISMISS_AFTER_MS = 4000;

export function showToast(type: ToastType, message: string): void {
	current = { type, message };
	clearTimeout(dismissTimeout);
	dismissTimeout = setTimeout(() => {
		current = null;
	}, DISMISS_AFTER_MS);
}

export function dismissToast(): void {
	clearTimeout(dismissTimeout);
	current = null;
}

export function getToast(): ToastState | null {
	return current;
}
