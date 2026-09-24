import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Liveness only — deliberately does not check Authentik/Dolibarr like the footer's system
// status does. An external dependency outage doesn't mean this process is unhealthy, and
// shouldn't make an orchestrator treat this container as failed over something a restart can't
// fix. (Plain Docker/Compose doesn't actually restart a container just for being reported
// `unhealthy` — only `restart: always`/`unless-stopped` reacting to the process actually exiting
// does that. An orchestrator like Swarm/Kubernetes is what would act on the health status itself,
// which is the scenario this separation guards against.)
// No auth: this is meant for Docker/infra to poll, not a member-facing page.
export const GET: RequestHandler = () => {
	return json({ status: 'ok' });
};
