// Client-safe (imported from both the server module and the Svelte page) — the type/label/icon
// set the standalone wishlist tool already uses, kept identical so members don't relearn anything.
export type WishlistType = 'achat' | 'idee' | 'action' | 'autre';

export const WISHLIST_TYPES: { value: WishlistType; label: string; icon: string }[] = [
	{ value: 'achat', label: 'Achat', icon: '🛒' },
	{ value: 'idee', label: 'Idée', icon: '💡' },
	{ value: 'action', label: 'Action', icon: '🛠️' },
	{ value: 'autre', label: 'Autre', icon: '🧩' }
];

export function typeMeta(type: WishlistType) {
	return WISHLIST_TYPES.find((t) => t.value === type) ?? WISHLIST_TYPES[3];
}

// 'pending' items can still be voted on, edited (by their author, only while vote-free) and
// deleted by their author. Once an admin resolves one either way, it's frozen: no more votes, and
// the member who proposed it can no longer edit or delete it (an admin still can, either way).
export type WishlistStatus = 'pending' | 'exauce' | 'rejete';

export const STATUS_META: Record<Exclude<WishlistStatus, 'pending'>, { label: string; icon: string }> = {
	exauce: { label: 'Exaucé', icon: '✅' },
	rejete: { label: 'Rejeté', icon: '❌' }
};
