import { getDb } from '$lib/server/db';

// The compta_settings table (one row, id = 1) is created and seeded by migration 10 in
// src/lib/server/migrations.ts.

export interface ComptaSettings {
	// Days after coverage ends during which a member keeps access (status `en_grace`) before being
	// considered expired and deactivated — see docs/compta.md, "Droit de membre".
	delaiGraceJours: number;
}

export async function getComptaSettings(): Promise<ComptaSettings> {
	const sql = await getDb();
	const [row] = await sql<{ delai_grace_jours: number }[]>`
		SELECT delai_grace_jours FROM compta_settings WHERE id = 1
	`;
	return { delaiGraceJours: row.delai_grace_jours };
}

export async function updateComptaSettings(settings: ComptaSettings): Promise<void> {
	const sql = await getDb();
	await sql`UPDATE compta_settings SET delai_grace_jours = ${settings.delaiGraceJours} WHERE id = 1`;
}
