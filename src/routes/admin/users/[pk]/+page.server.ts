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
import { validateProfileSubmission, validateEmergencyContactsSubmission } from '$lib/server/profileValidation';
import { requireAdminUser } from '$lib/server/auth';
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

	const [profile, optin, tag, groups, emergencyContacts, rfidUid] = await Promise.all([
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
		getRfidUid(pk).catch(() => undefined)
	]);
	if (!profile) {
		error(404, 'Membre introuvable.');
	}

	return {
		pk,
		profile,
		fields: PROFILE_ATTRIBUTE_FIELDS,
		optin,
		tag,
		groups,
		emergencyContacts,
		maxEmergencyContacts: MAX_EMERGENCY_CONTACTS,
		rfidUid
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
			logAuditEvent(
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

		let mutation;
		try {
			mutation = await updateTrombinoscopeOptin(pk, optin);
		} catch {
			return fail(500, { optinError: "La sauvegarde de la visibilité a échoué, réessayez." });
		}

		logAuditEvent(
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

		logAuditEvent(
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
		logAuditEvent(
			{ sub: admin.sub, label: displayName(admin) },
			'admin',
			'emergencyContacts.update',
			{ pk },
			{ before: { contactCount: mutation.before.length }, after: { contactCount: mutation.after.length } }
		);

		return { emergencyContactsSuccess: true, emergencyContacts: result.contacts };
	},

	// Lets an admin force-regenerate a member's badge on their behalf (lost/stolen/unreachable
	// member) — the confirmation checkbox on the client is the only thing standing between a
	// misclick and immediately deactivating someone's physical access, so it mirrors /badge's own
	// warning UI rather than being a bare button.
	regenerateRfid: async ({ params, locals }) => {
		const admin = requireAdminUser(locals);
		const pk = resolvePk(params.pk);

		await regenerateRfidUid(pk);

		// Deliberately no UUID in `details` — same posture as the member's own /badge regenerate
		// action: a live physical-access credential is too sensitive to duplicate into the log.
		logAuditEvent({ sub: admin.sub, label: displayName(admin) }, 'admin', 'badge.regenerate', { pk });

		return { rfidRegenerated: true };
	}
};
