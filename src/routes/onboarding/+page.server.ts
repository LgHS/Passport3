import { fail, redirect } from '@sveltejs/kit';
import type { Action, Actions, PageServerLoad } from './$types';
import {
	getEmergencyContacts,
	getOnboardingStatus,
	getUserProfile,
	markOnboardingCompleted,
	MAX_EMERGENCY_CONTACTS
} from '$lib/server/authentikAdmin';
import { logAuditEvent } from '$lib/server/auditLog';
import { hasUploadedAvatar } from '$lib/server/avatars';
import { authentikPk, displayName } from '$lib/types';
import { actions as profileActions } from '../profile/+page.server';

// PROTOTYPE of the first-login journey (/onboarding). Its profile, photo and emergency contact
// steps really save — through /profile's own actions, re-used as they are, so the rules, audit and
// validation are the same. Finishing the journey sets the `onboarding` attribute in Authentik;
// nothing redirects here yet.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const pk = authentikPk(locals.user);
	const [profile, contacts, onboarding] = pk
		? await Promise.all([
				getUserProfile(pk).catch(() => null),
				getEmergencyContacts(pk).catch(() => null),
				getOnboardingStatus(pk).catch(() => null)
			])
		: [null, null, null];

	// Journey already done: nothing to do here, back to the home page.
	if (onboarding?.completedAt) redirect(303, '/');

	return {
		firstName: (profile?.name ?? locals.user.name ?? '').trim().split(/\s+/)[0] || 'toi',
		profile,
		hasLocalAvatar: profile ? hasUploadedAvatar(profile.email) : false,
		emergencyContacts: contacts ?? [],
		maxEmergencyContacts: MAX_EMERGENCY_CONTACTS
	};
};

// The last step: the ROI is accepted, the journey is done.
const complete: Action = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) redirect(302, '/login');
	const pk = authentikPk(user);
	if (!pk) return fail(400, { onboardingError: 'Compte introuvable.' });

	const formData = await request.formData();
	if (formData.get('roiAccepted') !== 'on') {
		return fail(400, { onboardingError: 'Tu dois accepter le règlement d’ordre intérieur pour terminer.' });
	}

	try {
		const completedAt = await markOnboardingCompleted(pk);
		await logAuditEvent({ sub: user.sub, label: displayName(user) }, 'user', 'onboarding.complete', { pk }, { completedAt });
		return { onboardingCompleted: true };
	} catch {
		return fail(503, { onboardingError: 'Service temporairement indisponible. Réessaie dans quelques instants.' });
	}
};

export const actions = {
	updateProfile: profileActions.updateProfile,
	uploadAvatar: profileActions.uploadAvatar,
	regenerateAvatar: profileActions.regenerateAvatar,
	deleteAvatar: profileActions.deleteAvatar,
	updateEmergencyContacts: profileActions.updateEmergencyContacts,
	complete
} as unknown as Actions;
