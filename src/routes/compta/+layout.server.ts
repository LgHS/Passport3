import type { LayoutServerLoad } from './$types';
import { requireTresorier } from '$lib/server/auth';

// Guards page loads only — form actions under /compta/* call requireTresorier themselves (see
// auth.ts for why the layout guard doesn't cover them).
export const load: LayoutServerLoad = ({ locals }) => {
	requireTresorier(locals);
};
