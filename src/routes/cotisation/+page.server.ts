import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getMemberByEmail,
	getMemberSubscriptions,
	getMemberTypes,
	deriveCotisationStatus,
	parseDolibarrDate
} from '$lib/server/dolibarr';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const email = locals.user.email;
	if (!email) {
		error(500, 'Impossible de résoudre votre adresse email pour interroger Dolibarr.');
	}

	const member = await getMemberByEmail(email);
	if (!member) {
		error(404, 'Aucun adhérent Dolibarr trouvé pour votre adresse email.');
	}

	const [types, subscriptions] = await Promise.all([
		getMemberTypes(),
		getMemberSubscriptions(member.id)
	]);

	return {
		status: deriveCotisationStatus(member, types),
		datefin: parseDolibarrDate(member.datefin),
		subscriptions
	};
};
