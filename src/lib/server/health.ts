import { requireEnv } from '$lib/server/env';
import type { ServiceStatus, SystemStatus } from '$lib/types';

export type { SystemStatus };

// Every logged-in member sees this in the footer on every page — a live check on every request
// would add real latency (and a new failure point) to the entire site, not just an admin tool.
// Cached instead: one refresh per TTL, everyone else gets the cached read.
const CACHE_TTL_MS = 60_000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;

let cached: { status: SystemStatus; expiresAt: number } | null = null;

async function checkAuthentik(): Promise<ServiceStatus> {
	const start = Date.now();
	try {
		const origin = new URL(requireEnv('AUTHENTIK_ISSUER')).origin;
		const res = await fetch(`${origin}/-/health/live/`, {
			signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
		});
		return { healthy: res.ok, latencyMs: Date.now() - start };
	} catch {
		return { healthy: false, latencyMs: Date.now() - start };
	}
}

async function checkDolibarr(): Promise<ServiceStatus> {
	const start = Date.now();
	try {
		const base = requireEnv('DOLIBARR_URL').replace(/\/+$/, '');
		const res = await fetch(`${base}/api/index.php/status`, {
			headers: { DOLAPIKEY: requireEnv('DOLIBARR_API_KEY') },
			signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
		});
		return { healthy: res.ok, latencyMs: Date.now() - start };
	} catch {
		return { healthy: false, latencyMs: Date.now() - start };
	}
}

export async function getSystemStatus(): Promise<SystemStatus> {
	if (cached && cached.expiresAt > Date.now()) {
		return cached.status;
	}

	const [authentik, dolibarr] = await Promise.all([checkAuthentik(), checkDolibarr()]);
	const status: SystemStatus = { authentik, dolibarr };
	cached = { status, expiresAt: Date.now() + CACHE_TTL_MS };
	return status;
}
