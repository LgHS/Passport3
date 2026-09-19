import { WISHLIST_TYPES, type WishlistType } from '$lib/wishlistDisplay';
import type { WishlistItemInput } from '$lib/server/wishlist';

export type WishlistValidationResult =
	| { ok: true; input: WishlistItemInput }
	| { ok: false; error: string };

const VALID_TYPES = WISHLIST_TYPES.map((t) => t.value);

export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 2000;

export function validateWishlistItemSubmission(formData: FormData): WishlistValidationResult {
	const title = String(formData.get('title') ?? '').trim();
	if (!title) {
		return { ok: false, error: 'Le titre ne peut pas être vide.' };
	}
	if (title.length > TITLE_MAX_LENGTH) {
		return { ok: false, error: `Le titre ne peut pas dépasser ${TITLE_MAX_LENGTH} caractères.` };
	}

	const type = String(formData.get('type') ?? '').trim();
	if (!VALID_TYPES.includes(type as WishlistType)) {
		return { ok: false, error: 'Type invalide.' };
	}

	// Quantity only means anything for a purchase — the field isn't even rendered for the other
	// types, so it's never submitted for those. Default to 1 rather than requiring a value the
	// form doesn't collect.
	let quantity = 1;
	if (type === 'achat') {
		quantity = Number(String(formData.get('quantity') ?? '').trim());
		if (!Number.isInteger(quantity) || quantity < 1) {
			return { ok: false, error: 'La quantité doit être un nombre entier positif.' };
		}
	}

	const link = String(formData.get('link') ?? '').trim();
	if (link) {
		try {
			new URL(link);
		} catch {
			return { ok: false, error: 'Lien invalide (doit être une URL complète, ex. https://...).' };
		}
	}

	const amountRaw = String(formData.get('estimatedAmount') ?? '').trim();
	let estimatedAmount: number | null = null;
	if (amountRaw) {
		const parsed = Number(amountRaw.replace(',', '.'));
		if (!Number.isFinite(parsed) || parsed < 0) {
			return { ok: false, error: 'Montant estimé invalide.' };
		}
		estimatedAmount = parsed;
	}

	const description = String(formData.get('description') ?? '').trim();
	if (description.length > DESCRIPTION_MAX_LENGTH) {
		return {
			ok: false,
			error: `La description ne peut pas dépasser ${DESCRIPTION_MAX_LENGTH} caractères.`
		};
	}

	return {
		ok: true,
		input: {
			title,
			description: description || null,
			link: link || null,
			quantity,
			estimatedAmount,
			type: type as WishlistType
		}
	};
}
