import { env } from '$env/dynamic/public';

export interface AppUser {
	sub: string;
	email?: string;
	name?: string;
	preferred_username?: string;
	groups?: string[];
}

export function displayName(user: AppUser): string {
	return user.name ?? user.preferred_username ?? user.email ?? user.sub;
}

// Requires the Authentik OAuth2 provider's Subject Mode to be "Based on the User's ID", which
// makes `sub` the exact same integer pk used by Authentik's /core/users/{pk}/ API — no lookup
// call needed, and no staleness/reuse risk the way a username-based lookup would have.
export function authentikPk(user: AppUser): number | null {
	const pk = Number(user.sub);
	return Number.isInteger(pk) && pk > 0 ? pk : null;
}

export function isAdmin(user: AppUser): boolean {
	const adminGroup = env.PUBLIC_AUTHENTIK_ADMIN_GROUP;
	return adminGroup ? (user.groups?.includes(adminGroup) ?? false) : false;
}

export type CotisationStatus = 'a_jour' | 'en_attente' | 'expiree' | 'non_applicable';

export const COTISATION_STATUS_LABEL: Record<CotisationStatus, string> = {
	a_jour: 'Cotisation à jour',
	en_attente: 'Cotisation en attente',
	expiree: 'Cotisation expirée',
	non_applicable: "Membre d'honneur"
};

export const COTISATION_STATUS_COLOR: Record<CotisationStatus, string> = {
	a_jour: '#22c55e',
	en_attente: '#f97316',
	expiree: '#ef4444',
	non_applicable: 'var(--color-lghs-yellow)'
};

export interface ServiceStatus {
	healthy: boolean;
	// Time the check itself took, in ms — kept even on failure/timeout so a slow-then-failing
	// service can be told apart from an instant connection refusal.
	latencyMs: number;
}

export interface SystemStatus {
	authentik: ServiceStatus;
	dolibarr: ServiceStatus;
}

export interface ProfileAttributeField {
	key: string;
	label: string;
	required: boolean;
}

export interface UserProfile {
	username: string;
	name: string;
	email: string;
	avatar: string | null;
	attributes: Record<string, string>;
}

export interface EmergencyContact {
	name: string;
	phone: string;
	relation: string;
}
