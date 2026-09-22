import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Liveness only — deliberately does not check Authentik/Dolibarr like the footer's system
// status does. An external dependency outage doesn't mean this process is broken, and treating
// it as such would make Docker restart Passport3 in a loop over something a restart can't fix.
// No auth: this is meant for Docker/infra to poll, not a member-facing page.
export const GET: RequestHandler = () => {
	return json({ status: 'ok' });
};
