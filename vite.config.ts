import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Self-hosted in a Docker container (see Dockerfile) — a fixed Node target, not
			// adapter-auto's environment-detection.
			adapter: adapter(),

			// Report-only for now: violations only show up in the browser console, nothing is
			// blocked — switch `reportOnly` to `directives` once prod has run clean for a while.
			// `mode: 'auto'` lets SvelteKit add nonces/hashes to its own inline scripts, and it
			// adds 'unsafe-inline' to style-src by itself in dev (Vite/HMR inject <style> tags),
			// so local dev isn't affected. 'unsafe-inline' is still needed on style-src in prod
			// for Svelte transitions, which also inject <style> elements.
			csp: {
				mode: 'auto',
				reportOnly: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					// Avatars (Gravatar) and app icons come from Authentik-controlled external URLs.
					'img-src': ['self', 'data:', 'https:'],
					'font-src': ['self', 'data:'],
					'connect-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					// Required by SvelteKit for report-only mode — see src/routes/csp-report.
					'report-uri': ['/csp-report']
					// No `form-action`: /logout's POST redirects to Authentik's end-session
					// endpoint, and Chrome applies form-action to redirects after a submit.
				}
			}
		})
	]
});
