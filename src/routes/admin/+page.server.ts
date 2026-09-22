import type { PageServerLoad } from './$types';
import { listUsers } from '$lib/server/authentikAdmin';

export const load: PageServerLoad = async () => {
	return { users: await listUsers() };
};
