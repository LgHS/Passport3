import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/auth';

// Admin-only preview of the error page (+error.svelte): /admin/error-preview/404, /403, /500 or
// /503 throws that error on purpose, so its page can be checked without breaking anything.
const PREVIEWABLE = new Set([403, 404, 500, 503]);

export const load: PageServerLoad = ({ params, locals }) => {
	// Checked here too, not only in admin/+layout.server.ts: a layout's load runs in parallel with
	// this one, so this error would otherwise be thrown before the admin check.
	requireAdmin(locals);
	const code = Number(params.code);
	error(PREVIEWABLE.has(code) ? code : 404);
};
