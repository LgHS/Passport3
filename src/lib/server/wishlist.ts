import { getDb } from '$lib/server/db';
import type { WishlistStatus, WishlistType } from '$lib/wishlistDisplay';

// wishlist_items and wishlist_votes are created by src/lib/server/migrations.ts (run once from
// db.ts's getDb()) — see that file's migrations 3 and 4.

export interface WishlistAuthor {
	sub: string;
	label: string;
}

export interface WishlistItemInput {
	title: string;
	description: string | null;
	link: string | null;
	quantity: number;
	estimatedAmount: number | null;
	type: WishlistType;
}

export interface WishlistItem {
	id: number;
	createdAt: string;
	authorSub: string;
	authorLabel: string;
	title: string;
	description: string | null;
	link: string | null;
	quantity: number;
	estimatedAmount: number | null;
	type: WishlistType;
	status: WishlistStatus;
	resolvedAt: string | null;
	upVoters: string[];
	downVoters: string[];
	// null when not logged in or hasn't voted — distinct from 1/-1, drives the toggle button state.
	myVote: 1 | -1 | null;
}

interface WishlistItemRow {
	id: number;
	created_at: Date;
	author_sub: string;
	author_label: string;
	title: string;
	description: string | null;
	link: string | null;
	quantity: number;
	estimated_amount: number | null;
	type: string;
	status: string;
	resolved_at: Date | null;
}

interface WishlistVoteRow {
	item_id: number;
	voter_sub: string;
	voter_label: string;
	value: number;
}

export async function createWishlistItem(author: WishlistAuthor, input: WishlistItemInput): Promise<number> {
	const sql = await getDb();
	const [row] = await sql<{ id: number }[]>`
		INSERT INTO wishlist_items (author_sub, author_label, title, description, link, quantity, estimated_amount, type)
		VALUES (${author.sub}, ${author.label}, ${input.title}, ${input.description}, ${input.link}, ${input.quantity}, ${input.estimatedAmount}, ${input.type})
		RETURNING id
	`;
	return row.id;
}

export async function updateWishlistItem(itemId: number, input: WishlistItemInput): Promise<void> {
	const sql = await getDb();
	await sql`
		UPDATE wishlist_items
		SET title = ${input.title}, description = ${input.description}, link = ${input.link},
		    quantity = ${input.quantity}, estimated_amount = ${input.estimatedAmount}, type = ${input.type}
		WHERE id = ${itemId}
	`;
}

export async function setWishlistItemStatus(itemId: number, status: WishlistStatus): Promise<void> {
	// Reverting to 'pending' clears resolved_at back to null — it's not "resolved" anymore, so a
	// stale date shouldn't linger for the next time it gets decided. A bound parameter now, not an
	// interpolated SQL fragment — simpler than the SQLite version, not just safer.
	const resolvedAt = status === 'pending' ? null : new Date();
	const sql = await getDb();
	await sql`UPDATE wishlist_items SET status = ${status}, resolved_at = ${resolvedAt} WHERE id = ${itemId}`;
}

// Toggle model: voting the same direction again removes the vote, voting the other direction
// switches it, voting fresh inserts it. One row per (item, voter) enforced by a UNIQUE constraint.
// Wrapped in a transaction so the read-then-branch below is at least atomic with itself; this
// narrows but doesn't fully close the race at READ COMMITTED isolation (two truly concurrent votes
// from the same voter on the same item could both see "no existing row" and both attempt the
// INSERT branch) — the UNIQUE constraint then turns that into a thrown error rather than
// corruption, which is an acceptable residual risk for a double-click/double-tab edge case.
export async function castVote(itemId: number, voter: WishlistAuthor, value: 1 | -1): Promise<void> {
	const sql = await getDb();
	await sql.begin(async (tx) => {
		const [existing] = await tx<{ value: number }[]>`
			SELECT value FROM wishlist_votes WHERE item_id = ${itemId} AND voter_sub = ${voter.sub}
		`;

		if (existing?.value === value) {
			await tx`DELETE FROM wishlist_votes WHERE item_id = ${itemId} AND voter_sub = ${voter.sub}`;
		} else if (existing) {
			await tx`
				UPDATE wishlist_votes SET value = ${value}, voter_label = ${voter.label}, created_at = now()
				WHERE item_id = ${itemId} AND voter_sub = ${voter.sub}
			`;
		} else {
			await tx`
				INSERT INTO wishlist_votes (item_id, voter_sub, voter_label, value)
				VALUES (${itemId}, ${voter.sub}, ${voter.label}, ${value})
			`;
		}
	});
}

export interface WishlistItemForAuth {
	authorSub: string;
	status: WishlistStatus;
	voteCount: number;
	title: string;
	description: string | null;
	link: string | null;
	quantity: number;
	estimatedAmount: number | null;
	type: WishlistType;
}

// Everything the create/edit/vote/delete/resolve actions need to authorize themselves, in one
// query — avoids a separate vote-count round trip just to check "is this still vote-free". Also
// doubles as the "before" snapshot for the audit trail on edit/delete, since it already has every
// field those need.
export async function getWishlistItemForAuth(itemId: number): Promise<WishlistItemForAuth | null> {
	const sql = await getDb();
	const [row] = await sql<
		{
			author_sub: string;
			status: string;
			title: string;
			description: string | null;
			link: string | null;
			quantity: number;
			estimated_amount: number | null;
			type: string;
			vote_count: number;
		}[]
	>`
		SELECT i.author_sub, i.status, i.title, i.description, i.link, i.quantity, i.estimated_amount, i.type,
		       (SELECT COUNT(*)::int FROM wishlist_votes v WHERE v.item_id = i.id) AS vote_count
		FROM wishlist_items i WHERE i.id = ${itemId}
	`;

	return row
		? {
				authorSub: row.author_sub,
				status: row.status as WishlistStatus,
				voteCount: row.vote_count,
				title: row.title,
				description: row.description,
				link: row.link,
				quantity: row.quantity,
				estimatedAmount: row.estimated_amount,
				type: row.type as WishlistType
			}
		: null;
}

export async function deleteWishlistItem(itemId: number): Promise<void> {
	const sql = await getDb();
	await sql`DELETE FROM wishlist_items WHERE id = ${itemId}`;
}

// One query for the items, one for every vote across all of them (not N+1 per item) — the same
// batch-fetch shape as the audit log's target-label resolution.
export async function listWishlistItems(viewerSub: string | null): Promise<WishlistItem[]> {
	const sql = await getDb();
	const items = await sql<WishlistItemRow[]>`SELECT * FROM wishlist_items ORDER BY id DESC`;
	const votes = await sql<WishlistVoteRow[]>`SELECT item_id, voter_sub, voter_label, value FROM wishlist_votes`;

	const votesByItem = new Map<number, WishlistVoteRow[]>();
	for (const vote of votes) {
		const list = votesByItem.get(vote.item_id) ?? [];
		list.push(vote);
		votesByItem.set(vote.item_id, list);
	}

	return items.map((item) => {
		const itemVotes = votesByItem.get(item.id) ?? [];
		const myVote = viewerSub ? itemVotes.find((v) => v.voter_sub === viewerSub)?.value ?? null : null;

		return {
			id: item.id,
			createdAt: item.created_at.toISOString(),
			authorSub: item.author_sub,
			authorLabel: item.author_label,
			title: item.title,
			description: item.description,
			link: item.link,
			quantity: item.quantity,
			estimatedAmount: item.estimated_amount,
			type: item.type as WishlistType,
			status: item.status as WishlistStatus,
			resolvedAt: item.resolved_at ? item.resolved_at.toISOString() : null,
			upVoters: itemVotes.filter((v) => v.value === 1).map((v) => v.voter_label),
			downVoters: itemVotes.filter((v) => v.value === -1).map((v) => v.voter_label),
			myVote: (myVote as 1 | -1 | null) ?? null
		};
	});
}
