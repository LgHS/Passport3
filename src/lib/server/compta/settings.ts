import { getDb } from '$lib/server/db';

// The compta_settings table (one row, id = 1) is created and seeded by migration 10 in
// src/lib/server/migrations.ts; the invoice fields were added by migration 11.

export interface ComptaSettings {
	// Days after coverage ends during which a member keeps access (status `en_grace`) before being
	// considered expired and deactivated — see docs/compta.md, "Droit de membre".
	delaiGraceJours: number;
	// What issued invoices print about the ASBL.
	emetteurNom: string;
	emetteurAdresse: string;
	emetteurNumeroEntreprise: string;
	emetteurEmail: string;
	emetteurIban: string;
	// Printed on every invoice — the franchise regime wording (art. 56bis CTVA).
	mentionTva: string;
	// Default due date = issue date + this many days.
	delaiPaiementJours: number;
	// Whether adhesionSync.ts may deactivate/reactivate Authentik accounts — see migration 14.
	desactivationAuto: boolean;
}

interface SettingsRow {
	delai_grace_jours: number;
	emetteur_nom: string;
	emetteur_adresse: string;
	emetteur_numero_entreprise: string;
	emetteur_email: string;
	emetteur_iban: string;
	mention_tva: string;
	delai_paiement_jours: number;
	desactivation_auto: boolean;
}

export async function getComptaSettings(): Promise<ComptaSettings> {
	const sql = await getDb();
	const [r] = await sql<SettingsRow[]>`
		SELECT delai_grace_jours, emetteur_nom, emetteur_adresse, emetteur_numero_entreprise, emetteur_email,
		       emetteur_iban, mention_tva, delai_paiement_jours, desactivation_auto
		FROM compta_settings WHERE id = 1
	`;
	return {
		delaiGraceJours: r.delai_grace_jours,
		emetteurNom: r.emetteur_nom,
		emetteurAdresse: r.emetteur_adresse,
		emetteurNumeroEntreprise: r.emetteur_numero_entreprise,
		emetteurEmail: r.emetteur_email,
		emetteurIban: r.emetteur_iban,
		mentionTva: r.mention_tva,
		delaiPaiementJours: r.delai_paiement_jours,
		desactivationAuto: r.desactivation_auto
	};
}

export async function updateComptaSettings(s: ComptaSettings): Promise<void> {
	const sql = await getDb();
	await sql`
		UPDATE compta_settings SET
			delai_grace_jours = ${s.delaiGraceJours}, emetteur_nom = ${s.emetteurNom}, emetteur_adresse = ${s.emetteurAdresse},
			emetteur_numero_entreprise = ${s.emetteurNumeroEntreprise}, emetteur_email = ${s.emetteurEmail},
			emetteur_iban = ${s.emetteurIban}, mention_tva = ${s.mentionTva}, delai_paiement_jours = ${s.delaiPaiementJours},
			desactivation_auto = ${s.desactivationAuto}
		WHERE id = 1
	`;
}
