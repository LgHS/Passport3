import { getDb } from '$lib/server/db';
import { estDepense, estRecette, type RubriqueOfficielle } from '$lib/rubriques';

// Where the heading of the official statement is stored for each kind of document (migration
// 27). NULL is "the default for this kind of document" ($lib/rubriques.ts, rubriqueParDefaut).

export type RubriqueCible = 'facture' | 'cotisation' | 'note_de_frais' | 'lettrage';

const TABLES: Record<RubriqueCible, string> = {
	facture: 'factures',
	cotisation: 'cotisations',
	note_de_frais: 'notes_de_frais',
	lettrage: 'lettrages'
};

export class RubriqueError extends Error {}

export async function definirRubrique(cible: RubriqueCible, id: number, rubrique: RubriqueOfficielle | null): Promise<void> {
	if (rubrique !== null && !estRecette(rubrique) && !estDepense(rubrique)) throw new RubriqueError('Rubrique inconnue.');
	const sql = await getDb();
	// The table name comes from the fixed map above, never from the caller.
	const rows = await sql`UPDATE ${sql(TABLES[cible])} SET rubrique = ${rubrique} WHERE id = ${id} RETURNING id`;
	if (rows.length === 0) throw new RubriqueError('Document introuvable.');
}
