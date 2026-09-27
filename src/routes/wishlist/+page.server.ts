import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	listWishlistItems,
	createWishlistItem,
	updateWishlistItem,
	setWishlistItemStatus,
	castVote,
	getWishlistItemForAuth,
	deleteWishlistItem
} from '$lib/server/wishlist';
import { validateWishlistItemSubmission } from '$lib/server/wishlistValidation';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, isAdmin, type AppUser } from '$lib/types';

function requireUser(locals: App.Locals): AppUser {
	if (!locals.user) {
		redirect(302, '/login');
	}
	return locals.user;
}

// The wishlist shows who proposed/voted by their Authentik username (matching the reference tool
// this replaces), not their full name — displayName() is the fallback for the rare case a user
// has no preferred_username at all.
function usernameLabel(user: AppUser): string {
	return user.preferred_username ?? displayName(user);
}

// The audit trail's target is the item's author, not the acting admin — mirrors the rest of the
// app's convention (e.g. an admin editing a member's profile logs the member as the target), so
// an author sees on their own /profile "Historique" when an admin touched their proposal. Subject
// mode makes sub the same integer as the Authentik pk (see authentikPk() in $lib/types).
function targetFromSub(sub: string): { pk: number } | Record<string, never> {
	const pk = Number(sub);
	return Number.isInteger(pk) && pk > 0 ? { pk } : {};
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const admin = isAdmin(user);

	// Swap the raw authorSub for two precomputed decisions — the client only ever needs "can I
	// edit/delete this", not the Authentik subject id behind it.
	const items = (await listWishlistItems(user.sub)).map(({ authorSub, ...item }) => {
		const isOwnPendingItem = item.status === 'pending' && authorSub === user.sub;
		return {
			...item,
			canDelete: admin || isOwnPendingItem,
			canEdit: admin || (isOwnPendingItem && item.upVoters.length + item.downVoters.length === 0)
		};
	});

	return { items, isAdmin: admin };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		const result = validateWishlistItemSubmission(await request.formData());
		if (!result.ok) {
			return fail(400, { error: result.error });
		}

		const itemId = await createWishlistItem({ sub: user.sub, label: usernameLabel(user) }, result.input);

		// Always 'user' — creating is always on one's own behalf, there's no "admin creates on
		// someone else's account" equivalent here the way there is for edit/delete.
		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'user',
			'wishlist.create',
			targetFromSub(user.sub),
			{ itemId, title: result.input.title, type: result.input.type }
		);

		return { created: true };
	},

	edit: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		if (!Number.isInteger(itemId)) {
			return fail(400, { error: 'Requête invalide.' });
		}

		const item = await getWishlistItemForAuth(itemId);
		if (!item) {
			return fail(404, { error: 'Proposition introuvable.' });
		}

		const admin = isAdmin(user);
		const isOwnPendingItem = item.status === 'pending' && item.authorSub === user.sub;
		if (!admin && !(isOwnPendingItem && item.voteCount === 0)) {
			return fail(403, {
				error: admin
					? "Vous n'avez pas le droit de modifier cette proposition."
					: 'Cette proposition ne peut plus être modifiée (déjà votée ou déjà tranchée).'
			});
		}

		const result = validateWishlistItemSubmission(formData);
		if (!result.ok) {
			return fail(400, { error: result.error });
		}

		await updateWishlistItem(itemId, result.input);

		// 'user' when the author edits their own (still vote-free) proposal, 'admin' when an admin
		// edits someone else's — the authorization check above already guarantees admin-only for
		// the latter case.
		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			item.authorSub === user.sub ? 'user' : 'admin',
			'wishlist.edit',
			targetFromSub(item.authorSub),
			{
				before: {
					title: item.title,
					description: item.description,
					link: item.link,
					quantity: item.quantity,
					estimatedAmount: item.estimatedAmount,
					type: item.type
				},
				after: { ...result.input }
			}
		);

		return { edited: true };
	},

	vote: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		const direction = String(formData.get('value') ?? '');

		if (!Number.isInteger(itemId) || (direction !== 'up' && direction !== 'down')) {
			return fail(400, { error: 'Requête de vote invalide.' });
		}

		const item = await getWishlistItemForAuth(itemId);
		if (!item) {
			return fail(404, { error: 'Proposition introuvable.' });
		}
		if (item.status !== 'pending') {
			return fail(403, { error: 'Cette proposition a déjà été tranchée, le vote est clos.' });
		}

		await castVote(itemId, { sub: user.sub, label: usernameLabel(user) }, direction === 'up' ? 1 : -1);
		return { voted: true };
	},

	// Only the member who proposed a still-pending item, or an admin, can remove it. Once an
	// admin resolves it, the member's own delete/edit rights lapse — only an admin can touch it
	// from then on.
	delete: async ({ request, locals }) => {
		const user = requireUser(locals);
		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		if (!Number.isInteger(itemId)) {
			return fail(400, { error: 'Requête invalide.' });
		}

		const item = await getWishlistItemForAuth(itemId);
		if (!item) {
			return fail(404, { error: 'Proposition introuvable.' });
		}

		const admin = isAdmin(user);
		const isOwnPendingItem = item.status === 'pending' && item.authorSub === user.sub;
		if (!admin && !isOwnPendingItem) {
			return fail(403, { error: "Vous n'avez pas le droit de supprimer cette proposition." });
		}

		await deleteWishlistItem(itemId);

		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			item.authorSub === user.sub ? 'user' : 'admin',
			'wishlist.delete',
			targetFromSub(item.authorSub),
			{ title: item.title, type: item.type }
		);

		return { deleted: true };
	},

	// Admin-only: freezes the item (no more votes, no more member-side edit/delete) and marks it
	// as granted or turned down — or, passing 'pending', reverts an earlier decision back to open.
	resolve: async ({ request, locals }) => {
		const user = requireUser(locals);
		if (!isAdmin(user)) {
			return fail(403, { error: 'Réservé aux admins.' });
		}

		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		const status = String(formData.get('status') ?? '');
		if (!Number.isInteger(itemId) || (status !== 'exauce' && status !== 'rejete' && status !== 'pending')) {
			return fail(400, { error: 'Requête invalide.' });
		}

		const item = await getWishlistItemForAuth(itemId);
		if (!item) {
			return fail(404, { error: 'Proposition introuvable.' });
		}

		await setWishlistItemStatus(itemId, status);

		await logAuditEvent(
			{ sub: user.sub, label: displayName(user) },
			'admin',
			'wishlist.resolve',
			targetFromSub(item.authorSub),
			{ before: { status: item.status }, after: { status } }
		);

		return { resolved: true };
	}
};
