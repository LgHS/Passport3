import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';

export const SESSION_COOKIE = 'session';
export const OAUTH_STATE_COOKIE = 'oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'oauth_verifier';
// Separate from OAUTH_STATE_COOKIE above: this guards the GitHub identity-verification flow,
// distinct from (and not meant to interfere with) the Authentik login flow's own in-flight state.
export const GITHUB_OAUTH_STATE_COOKIE = 'github_oauth_state';

const baseCookieOptions = {
	path: '/',
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax' as const
};

export function setSessionCookie(cookies: Cookies, idToken: string, maxAgeSeconds: number) {
	cookies.set(SESSION_COOKIE, idToken, { ...baseCookieOptions, maxAge: maxAgeSeconds });
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function setOAuthCookies(cookies: Cookies, state: string, codeVerifier: string) {
	cookies.set(OAUTH_STATE_COOKIE, state, { ...baseCookieOptions, maxAge: 60 * 10 });
	cookies.set(OAUTH_VERIFIER_COOKIE, codeVerifier, { ...baseCookieOptions, maxAge: 60 * 10 });
}

export function clearOAuthCookies(cookies: Cookies) {
	cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
	cookies.delete(OAUTH_VERIFIER_COOKIE, { path: '/' });
}

export function setGithubOAuthStateCookie(cookies: Cookies, state: string) {
	cookies.set(GITHUB_OAUTH_STATE_COOKIE, state, { ...baseCookieOptions, maxAge: 60 * 10 });
}

export function clearGithubOAuthStateCookie(cookies: Cookies) {
	cookies.delete(GITHUB_OAUTH_STATE_COOKIE, { path: '/' });
}
