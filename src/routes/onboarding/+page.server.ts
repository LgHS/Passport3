import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEmergencyContacts, getUserProfile } from '$lib/server/authentikAdmin';
import { hasUploadedAvatar } from '$lib/server/avatars';
import { authentikPk } from '$lib/types';

// PROTOTYPE of the first-login journey (/onboarding): read-only, nothing is saved yet. It only
// pre-fills each step with what Passport already knows, best-effort, so the design can be judged
// on a real account. See the draft PR for what's left before it does anything.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const pk = authentikPk(locals.user);
	const [profile, contacts] = pk
		? await Promise.all([getUserProfile(pk).catch(() => null), getEmergencyContacts(pk).catch(() => null)])
		: [null, null];

	const attr = profile?.attributes ?? {};
	return {
		firstName: (profile?.name ?? locals.user.name ?? '').trim().split(/\s+/)[0] || 'toi',
		username: profile?.username ?? locals.user.preferred_username ?? '',
		avatar: profile?.avatar ?? null,
		hasPhoto: profile ? hasUploadedAvatar(profile.email) : false,
		infos: [
			{ label: 'Nom', value: profile?.name || null },
			{ label: 'Email', value: profile?.email || null },
			{ label: 'Téléphone', value: attr.phoneNumber || null },
			{ label: 'Adresse', value: [attr.street, attr.postal_code, attr.locality].filter(Boolean).join(', ') || null },
			{ label: 'Date de naissance', value: attr.birthday || null, optional: true }
		],
		contactCount: contacts?.length ?? 0
	};
};
