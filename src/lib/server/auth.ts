import { error, redirect } from '@sveltejs/kit';
import { isAdmin } from '$lib/types';

// SvelteKit form actions never run ancestor `+layout.server.ts` `load` functions — a POST to
// an action under /admin/* bypasses admin/+layout.server.ts's isAdmin check entirely. Every
// admin action must call this itself rather than relying on the layout guard.
export function requireAdmin(locals: App.Locals): void {
	if (!locals.user) {
		redirect(302, '/login');
	}
	if (!isAdmin(locals.user)) {
		error(403, 'Accès réservé aux administrateurs.');
	}
}
