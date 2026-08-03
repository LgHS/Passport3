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
	return Boolean(adminGroup) && (user.groups?.includes(adminGroup) ?? false);
}

export interface ProfileAttributeField {
	key: string;
	label: string;
}

export interface UserProfile {
	username: string;
	name: string;
	email: string;
	avatar: string | null;
	attributes: Record<string, string>;
}
