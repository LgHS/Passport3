import { base64url } from 'jose';

export function generateState(): string {
	return base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
}

export function generateCodeVerifier(): string {
	return base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
	return base64url.encode(new Uint8Array(digest));
}
