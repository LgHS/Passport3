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
