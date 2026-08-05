import type { PageServerLoad } from './$types';
import { listUserApplications, type UserApplication } from '$lib/server/authentikAdmin';
import { authentikPk } from '$lib/types';

export interface AppGroup {
	name: string;
	apps: UserApplication[];
}

const UNGROUPED_LABEL = 'Autres';

function groupApps(apps: UserApplication[]): AppGroup[] {
	const byGroup = new Map<string, UserApplication[]>();
	for (const app of apps) {
		const key = app.group ?? UNGROUPED_LABEL;
		if (!byGroup.has(key)) byGroup.set(key, []);
		byGroup.get(key)?.push(app);
	}

	return [...byGroup.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, apps]) => ({ name, apps }));
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		return { groups: null };
	}

	const pk = authentikPk(locals.user);
	if (!pk) {
		return { groups: null };
	}

	// Best-effort: a transient Authentik API hiccup shouldn't take down the whole homepage.
	const apps = await listUserApplications(pk).catch(() => null);
	return { groups: apps ? groupApps(apps) : null };
};
