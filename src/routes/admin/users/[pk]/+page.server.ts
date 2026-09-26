import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getUserProfile,
	updateUserProfile,
	PROFILE_ATTRIBUTE_FIELDS,
	getTrombinoscopeOptin,
	updateTrombinoscopeOptin,
	optinFromFormData,
	getTrombinoscopeTag,
	updateTrombinoscopeTag,
	getUserGroups,
	HEX_COLOR_RE,
	getEmergencyContacts,
	updateEmergencyContacts,
	MAX_EMERGENCY_CONTACTS,
	getRfidUid,
	regenerateRfidUid
} from '$lib/server/authentikAdmin';
import { lookupMattermostUsername, buildMattermostDmUrl } from '$lib/server/mattermost';
import {
	validateProfileSubmission,
	validateEmergencyContactsSubmission,
	validateTrombiEmail
} from '$lib/server/profileValidation';
import { requireAdminUser } from '$lib/server/auth';
import { deleteAvatar, getLocalAvatarUrl } from '$lib/server/avatars';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

function resolvePk(paramPk: string): number {
	const pk = Number(paramPk);
	if (!Number.isInteger(pk) || pk <= 0) {
		error(404, 'Membre introuvable.');
	}
	return pk;
}

export const load: PageServerLoad = async ({ params }) => {
	const pk = resolvePk(params.pk);

	const [profile, optin, tag, groups, emergencyContacts, rfidUid, hasLocalAvatar] = await Promise.all([
		getUserProfile(pk).catch(() => null),
		getTrombinoscopeOptin(pk),
		getTrombinoscopeTag(pk),
		// Best-effort, same reasoning as getUserProfile's .catch() above — a transient Authentik
		// hiccup on this specific call shouldn't 500 the whole edit page (profile, visibility, tag
		// all fail together via Promise.all) just because the Permissions section couldn't load.
		// null (not []) on failure — "couldn't check" must stay distinguishable from "genuinely no
		// groups", the two read very differently to an admin looking at someone's access.
		getUserGroups(pk).catch(() => null),
		// Same reasoning — an admin seeing "aucun contact" during an actual emergency must never be
		// a fetch hiccup in disguise, see feedback_distinguish-fetch-failure-from-empty.
		getEmergencyContacts(pk).catch(() => null),
		// getRfidUid's own return already uses `null` to mean "no badge assigned" — that's a
		// legitimate, distinct value from a fetch failure, so the failure case is `undefined` here
		// rather than reusing `null` and collapsing the two meanings together.
		getRfidUid(pk).catch(() => undefined),
		getLocalAvatarUrl(pk).then((url) => url !== null)
	]);
	if (!profile) {
		error(404, 'Membre introuvable.');
	}

	// Admin-only: shown regardless of the member's own "Pseudo Chat" opt-in on the
	// trombinoscope — this is an internal tool to reach a member for oral/email requests, not
	// the public directory, so it isn't gated by the same consent. `unavailable` stays
	// distinguishable from "no linked account" — see feedback_distinguish-fetch-failure-from-empty.
	const mattermost = await lookupMattermostUsername(profile.email);
	const mattermostDmUrl = mattermost.username ? buildMattermostDmUrl(mattermost.username) : null;

	return {
		pk,
		profile,
		fields: PROFILE_ATTRIBUTE_FIELDS,
		optin,
		tag,
		mattermostUsername: mattermost.username,
		mattermostUnavailable: mattermost.unavailable,
		mattermostDmUrl,
		groups,
		emergencyContacts,
		maxEmergencyContacts: MAX_EMERGENCY_CONTACTS,
		rfidUid,
		hasLocalAvatar
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, params, locals }) => {
		const admin = requireAdminUser(locals);

		const pk = resolvePk(params.pk);
		const result = validateProfileSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, {
				error: result.error,
				firstName: result.firstName,
				lastName: result.lastName,
				attributes: result.attributes
			});
		}

		// before/after come from updateUserProfile()'s own internal read, not a separate call here
		// — see the member-facing version of this same fix (src/routes/profile/+page.server.ts).
		const mutation = await updateUserProfile(pk, { name: result.name, attributes: result.attributes });

		if (mutation.changed) {
			await logAuditEvent(
				{ sub: admin.sub, label: displayName(admin) },
				'admin',
				'profile.update',
				{ pk },
				{ before: mutation.before, after: mutation.after }
			);
		}

		return {
			success: true,
			changed: mutation.changed,
			firstName: result.firstName,
			lastName: result.lastName,
			attributes: result.attributes
		};
	},

	// Lets an admin set another member's trombinoscope visibility on their behalf (oral/email
	// requests) — same read-merge-write helper as the member-facing form, but the target pk comes
	// from the trusted route param, never from form data.
	updateOptin: async ({ request, params, locals }) => {
		const admin = requireAdminUser(locals);

		const pk = resolvePk(params.pk);
		const formData = await request.formData();
		const optin = optinFromFormData(formData);

		const trombiEmailResult = validateTrombiEmail(optin.trombiEmail);
		if (!trombiEmailResult.ok) {
			return fail(400, { optinError: trombiEmailResult.error, optin });
		}
		optin.trombiEmail = trombiEmailResult.value;

		let mutation;
		try {
			mutation = await updateTrombinoscopeOptin(pk, optin);
		} catch {
			return fail(500, { optinError: "La sauvegarde de la visibilité a échoué, réessayez." });
		}

		await logAuditEvent(
			{ sub: admin.sub, label: displayName(admin) },
			'admin',
			'trombinoscope.optin.update',
			{ pk },
			{ before: mutation.before, after: mutation.after }
		);

		return { optinSuccess: true, optin };
	},

	// Admin-only role label (e.g. "Prés. CA") + badge color shown on the trombinoscope —
	// never edited by the member themselves, see TrombinoscopeTag.
	updateTag: async ({ request, params, locals }) => {
		const admin = requireAdminUser(locals);

		const pk = resolvePk(params.pk);
		const formData = await request.formData();
		const tag = String(formData.get('tag') ?? '').trim();
		const tagColor = String(formData.get('tagColor') ?? '')
			.trim()
			.replace(/^#/, '')
			.toLowerCase();

		if (tagColor && !HEX_COLOR_RE.test(tagColor)) {
			return fail(400, {
				tagError: 'Couleur invalide (format attendu : 6 caractères hexadécimaux, ex. ffd800).',
				tag,
				tagColor
			});
		}

		let mutation;
		try {
			mutation = await updateTrombinoscopeTag(pk, { tag: tag || null, tagColor: tagColor || null });
		} catch {
			return fail(500, { tagError: 'La sauvegarde du rôle a échoué, réessayez.', tag, tagColor });
		}

		await logAuditEvent(
			{ sub: admin.sub, label: displayName(admin) },
			'admin',
			'trombinoscope.tag.update',
			{ pk },
			{ before: mutation.before, after: mutation.after }
		);

		return { tagSuccess: true, tag, tagColor };
	},

	updateEmergencyContacts: async ({ request, params, locals }) => {
		const admin = requireAdminUser(locals);

		const pk = resolvePk(params.pk);
		const result = validateEmergencyContactsSubmission(await request.formData());

		if (!result.ok) {
			return fail(400, { emergencyContactsError: result.error, emergencyContacts: result.contacts });
		}

		let mutation;
		try {
			mutation = await updateEmergencyContacts(pk, result.contacts);
		} catch {
			return fail(500, {
				emergencyContactsError: "La sauvegarde des contacts d'urgence a échoué, réessayez.",
				emergencyContacts: result.contacts
			});
		}

		// Deliberately not logging the contacts themselves (names/phone numbers of third parties,
		// not even the member's own data) — just how many entries there were and how many there are
		// now. Same stricter-than-usual posture as the rest of this feature's admin-only visibility
		// rule.
		await logAuditEvent(
			{ sub: admin.sub, label: displayName(admin) },
			'admin',
			'emergencyContacts.update',
			{ pk },
			{ before: { contactCount: mutation.before.length }, after: { contactCount: mutation.after.length } }
		);

		return { emergencyContactsSuccess: true, emergencyContacts: result.contacts };
	},

	// Lets an admin force-regenerate a member's badge on their behalf (lost/stolen/unreachable
	// member) — the confirmation checkbox is enforced here, not just on the client: an admin
	// action invalidating someone else's physical-access credential is higher-stakes than the
	// member's own /badge regenerate (which exempts a first-ever badge, nothing to lose there —
	// this page always shows the warning, so it's always required here too).
	regenerateRfid: async ({ request, params, locals }) => {
		const admin = requireAdminUser(locals);
		const pk = resolvePk(params.pk);

		const formData = await request.formData();
		if (!formData.has('confirmRegenerate')) {
			return fail(400, { rfidError: 'Confirmation requise.' });
		}

		await regenerateRfidUid(pk);

		// Deliberately no UUID in `details` — same posture as the member's own /badge regenerate
		// action: a live physical-access credential is too sensitive to duplicate into the log.
		await logAuditEvent({ sub: admin.sub, label: displayName(admin) }, 'admin', 'badge.regenerate', { pk });

		return { rfidRegenerated: true };
	},

	// Moderation: removes a member's uploaded photo (they fall back to their generated initials). Admins can
	// only remove, never upload on someone's behalf — the photo is the member's own choice.
	deleteAvatar: async ({ params, locals }) => {
		const admin = requireAdminUser(locals);
		const pk = resolvePk(params.pk);
		if (await deleteAvatar(pk)) {
			await logAuditEvent({ sub: admin.sub, label: displayName(admin) }, 'admin', 'avatar.delete', { pk });
		}
		return { avatarDeleted: true };
	}
};
