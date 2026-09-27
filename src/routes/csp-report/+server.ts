import type { RequestHandler } from './$types';

// Collects the browser's CSP violation reports (see `csp` in vite.config.ts) into the server logs,
// so report-only mode tells us what enforcing the policy would break. Unauthenticated by nature —
// anything can POST here — so the body is capped and never parsed beyond
// what's needed to log it.
const MAX_REPORT_BYTES = 8 * 1024;

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.text();
	if (body.length <= MAX_REPORT_BYTES) {
		console.warn('[csp-report]', body.replace(/\s+/g, ' '));
	}
	return new Response(null, { status: 204 });
};
