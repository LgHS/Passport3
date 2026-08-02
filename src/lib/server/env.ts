import { env } from '$env/dynamic/private';

export function requireEnv(name: string): string {
	const value = env[name];
	if (!value) {
		throw new Error(`${name} is not configured. Set it in your .env file (see .env.example).`);
	}
	return value;
}
