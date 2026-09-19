import { getDb } from '$lib/server/db';
import type { WishlistStatus, WishlistType } from '$lib/wishlistDisplay';

// Lazy, idempotent — same rationale as db.ts and auditLog.ts's own lazy connections.
let schemaReady = false;

function ensureSchema(): void {
	if (schemaReady) return;
	const db = getDb();
	db.exec(`
		CREATE TABLE IF NOT EXISTS wishlist_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			author_sub TEXT NOT NULL,
			author_label TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT,
			link TEXT,
			quantity INTEGER NOT NULL DEFAULT 1,
			estimated_amount REAL,
			type TEXT NOT NULL
		)
	`);
	db.exec(`
		CREATE TABLE IF NOT EXISTS wishlist_votes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
			voter_sub TEXT NOT NULL,
			voter_label TEXT NOT NULL,
			value INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			UNIQUE(item_id, voter_sub)
		)
	`);

	// `status`/`resolved_at` shipped after this table already existed on some deployments (see
	// auditLog.ts's `source` column for the same pattern) — CREATE TABLE IF NOT EXISTS above is a
	// no-op there, so add the columns explicitly. Every pre-existing row predates resolution.
	const existingColumns = new Set(
		(db.pragma('table_info(wishlist_items)') as { name: string }[]).map((col) => col.name)
	);
	if (!existingColumns.has('status')) {
		db.exec(`ALTER TABLE wishlist_items ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`);
	}
	if (!existingColumns.has('resolved_at')) {
		db.exec(`ALTER TABLE wishlist_items ADD COLUMN resolved_at TEXT`);
	}

	schemaReady = true;
}

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
	created_at: string;
	author_sub: string;
	author_label: string;
	title: string;
	description: string | null;
	link: string | null;
	quantity: number;
	estimated_amount: number | null;
	type: string;
	status: string;
	resolved_at: string | null;
}

interface WishlistVoteRow {
	item_id: number;
	voter_sub: string;
	voter_label: string;
	value: number;
}

export function createWishlistItem(author: WishlistAuthor, input: WishlistItemInput): number {
	ensureSchema();
	const result = getDb()
		.prepare(
			`INSERT INTO wishlist_items (author_sub, author_label, title, description, link, quantity, estimated_amount, type)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			author.sub,
			author.label,
			input.title,
			input.description,
			input.link,
			input.quantity,
			input.estimatedAmount,
			input.type
		);
	return Number(result.lastInsertRowid);
}

export function updateWishlistItem(itemId: number, input: WishlistItemInput): void {
	ensureSchema();
	getDb()
		.prepare(
			`UPDATE wishlist_items
			 SET title = ?, description = ?, link = ?, quantity = ?, estimated_amount = ?, type = ?
			 WHERE id = ?`
		)
		.run(input.title, input.description, input.link, input.quantity, input.estimatedAmount, input.type, itemId);
}

export function setWishlistItemStatus(itemId: number, status: WishlistStatus): void {
	ensureSchema();
	// Reverting to 'pending' clears resolved_at back to null — it's not "resolved" anymore, so a
	// stale date shouldn't linger for the next time it gets decided.
	const resolvedAtExpr = status === 'pending' ? 'NULL' : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
	getDb()
		.prepare(`UPDATE wishlist_items SET status = ?, resolved_at = ${resolvedAtExpr} WHERE id = ?`)
		.run(status, itemId);
}

// Toggle model: voting the same direction again removes the vote, voting the other direction
// switches it, voting fresh inserts it. One row per (item, voter) enforced by a UNIQUE constraint.
export function castVote(itemId: number, voter: WishlistAuthor, value: 1 | -1): void {
	ensureSchema();
	const db = getDb();
	const existing = db
		.prepare(`SELECT value FROM wishlist_votes WHERE item_id = ? AND voter_sub = ?`)
		.get(itemId, voter.sub) as { value: number } | undefined;

	if (existing?.value === value) {
		db.prepare(`DELETE FROM wishlist_votes WHERE item_id = ? AND voter_sub = ?`).run(itemId, voter.sub);
	} else if (existing) {
		db.prepare(
			`UPDATE wishlist_votes SET value = ?, voter_label = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			 WHERE item_id = ? AND voter_sub = ?`
		).run(value, voter.label, itemId, voter.sub);
	} else {
		db.prepare(
			`INSERT INTO wishlist_votes (item_id, voter_sub, voter_label, value) VALUES (?, ?, ?, ?)`
		).run(itemId, voter.sub, voter.label, value);
	}
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
export function getWishlistItemForAuth(itemId: number): WishlistItemForAuth | null {
	ensureSchema();
	const row = getDb()
		.prepare(
			`SELECT i.author_sub, i.status, i.title, i.description, i.link, i.quantity, i.estimated_amount, i.type,
			        (SELECT COUNT(*) FROM wishlist_votes v WHERE v.item_id = i.id) AS vote_count
			 FROM wishlist_items i WHERE i.id = ?`
		)
		.get(itemId) as
		| {
				author_sub: string;
				status: string;
				title: string;
				description: string | null;
				link: string | null;
				quantity: number;
				estimated_amount: number | null;
				type: string;
				vote_count: number;
		  }
		| undefined;

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

export function deleteWishlistItem(itemId: number): void {
	ensureSchema();
	getDb().prepare(`DELETE FROM wishlist_items WHERE id = ?`).run(itemId);
}

// One query for the items, one for every vote across all of them (not N+1 per item) — the same
// batch-fetch shape as the audit log's target-label resolution.
export function listWishlistItems(viewerSub: string | null): WishlistItem[] {
	ensureSchema();
	const db = getDb();
	const items = db.prepare(`SELECT * FROM wishlist_items ORDER BY id DESC`).all() as WishlistItemRow[];
	const votes = db
		.prepare(`SELECT item_id, voter_sub, voter_label, value FROM wishlist_votes`)
		.all() as WishlistVoteRow[];

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
			createdAt: item.created_at,
			authorSub: item.author_sub,
			authorLabel: item.author_label,
			title: item.title,
			description: item.description,
			link: item.link,
			quantity: item.quantity,
			estimatedAmount: item.estimated_amount,
			type: item.type as WishlistType,
			status: item.status as WishlistStatus,
			resolvedAt: item.resolved_at,
			upVoters: itemVotes.filter((v) => v.value === 1).map((v) => v.voter_label),
			downVoters: itemVotes.filter((v) => v.value === -1).map((v) => v.voter_label),
			myVote: (myVote as 1 | -1 | null) ?? null
		};
	});
}
