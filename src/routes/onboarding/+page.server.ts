import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getEmergencyContacts, getUserProfile, MAX_EMERGENCY_CONTACTS } from '$lib/server/authentikAdmin';
import { hasUploadedAvatar } from '$lib/server/avatars';
import { authentikPk } from '$lib/types';
import { actions as profileActions } from '../profile/+page.server';

// PROTOTYPE of the first-login journey (/onboarding). Its profile, photo and emergency contact
// steps really save — through /profile's own actions, re-used as they are, so the rules, audit and
// validation are the same — but the journey itself (where the member is, whether it's done) isn't
// stored yet, and nothing redirects here.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const pk = authentikPk(locals.user);
	const [profile, contacts] = pk
		? await Promise.all([getUserProfile(pk).catch(() => null), getEmergencyContacts(pk).catch(() => null)])
		: [null, null];

	return {
		firstName: (profile?.name ?? locals.user.name ?? '').trim().split(/\s+/)[0] || 'toi',
		profile,
		hasLocalAvatar: profile ? hasUploadedAvatar(profile.email) : false,
		emergencyContacts: contacts ?? [],
		maxEmergencyContacts: MAX_EMERGENCY_CONTACTS
	};
};

export const actions = {
	updateProfile: profileActions.updateProfile,
	uploadAvatar: profileActions.uploadAvatar,
	regenerateAvatar: profileActions.regenerateAvatar,
	deleteAvatar: profileActions.deleteAvatar,
	updateEmergencyContacts: profileActions.updateEmergencyContacts
} as unknown as Actions;
