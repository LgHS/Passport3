import type { WishlistStatus } from '$lib/wishlistDisplay';

// Who may do what to a wishlist proposal. Pure functions, no database and no environment, so
// tests/wishlistRules.test.ts can cover them; +page.server.ts enforces them, in its load (what the
// page offers) as well as in each action (what the server accepts). Admin-ness is passed in as a
// boolean, same as $lib/taskRules: isAdmin() reads the environment.

type Item = { status: WishlistStatus; authorSub: string };

// Its author, while the proposal is still open.
const isOwnPendingItem = (item: Item, sub: string) => item.status === 'pending' && item.authorSub === sub;

// Editing: admins always; the author only while it's open and nobody has voted yet, so votes are
// never cast on a text that changes afterwards.
export const canEditItem = (item: Item & { voteCount: number }, sub: string, admin: boolean): boolean =>
	admin || (isOwnPendingItem(item, sub) && item.voteCount === 0);

// Deleting: admins always; the author while it's open, votes or not. Once an admin has decided,
// only an admin can touch it.
export const canDeleteItem = (item: Item, sub: string, admin: boolean): boolean =>
	admin || isOwnPendingItem(item, sub);

// Voting closes with the decision.
export const canVote = (item: Pick<Item, 'status'>): boolean => item.status === 'pending';

// What an admin can set a proposal to: granted, turned down, or back to open.
export const isResolveStatus = (status: string): status is WishlistStatus =>
	status === 'exauce' || status === 'rejete' || status === 'pending';

// Only a fresh decision is announced on Mattermost: not a revert to pending, not the same status
// set again.
export const shouldAnnounceResolution = (
	before: WishlistStatus,
	after: WishlistStatus
): after is Exclude<WishlistStatus, 'pending'> =>
	after !== 'pending' && after !== before;
