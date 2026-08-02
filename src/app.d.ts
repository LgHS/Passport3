// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AppUser } from '$lib/types';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: AppUser | null;
		}
		interface PageData {
			user: AppUser | null;
			avatarUrl: string | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
