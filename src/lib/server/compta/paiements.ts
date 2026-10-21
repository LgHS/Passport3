import { getDb } from '$lib/server/db';
import { addUTCDays, parseIsoDate, parseMoney } from './dates';
import type { FactureSens, FactureType } from './factures';

// A member's payment history — docs/compta.md, "Historique des paiements": the money that actually
// moved between them (or an organisation they administer) and the ASBL, and what each payment
// settled, plus what is still owed. Read from the books themselves:
//
// - an allocation (lettrage) of a bank or cash movement to one of their invoices, cotisations or
//   expense claims — dated by the movement, signed by its direction;
// - an invoice or cotisation the treasury marked paid by hand, with no movement behind it;
// - the subscriptions and invoices imported from Dolibarr, which carry no movement either.
//
// Only what the member may see: date, amount, what it paid and how. Never the bank line's own
// label or counterparty, which are the treasury's.

export type ModePaiement = 'banque' | 'caisse' | 'manuel' | 'dolibarr';

export interface Paiement {
	date: Date;
	// Positive: paid to the ASBL. Negative: paid back by the ASBL (expense claim, credit note).
	montant: number;
	objet: string;
	// The organisation it was for, when it isn't the member's own.
	pour: string | null;
	mode: ModePaiement;
}

export interface ResteDu {
	factureId: number;
	numero: string;
	pour: string | null;
	total: number;
	reste: number;
	echeance: Date | null;
	communication: string | null;
}

export interface HistoriquePaiements {
	paiements: Paiement[];
	resteDu: ResteDu[];
}

// Rows as the queries below return them — the input of the pure assembly, so it can be tested
// without a database.
export interface LettrageRow {
	tiers_id: number;
	montant: string;
	date: string;
	mouvement_montant: string;
	compte_type: 'banque' | 'caisse';
	cible_type: 'facture' | 'cotisation' | 'note_de_frais';
	facture_numero: string | null;
	facture_type: FactureType | null;
	facture_sens: FactureSens | null;
	cotisation_debut: string | null;
	cotisation_fin: string | null;
	note_libelle: string | null;
}

export interface FacturePayeeRow {
	tiers_id: number;
	numero: string | null;
	type: FactureType;
	sens: FactureSens;
	total: string;
	date: string | null;
	importee: boolean;
}

export interface CotisationPayeeRow {
	tiers_id: number;
	debut: string;
	fin: string;
	montant: string;
	date: string | null;
	importee: boolean;
}

export interface FactureDueRow {
	id: number;
	tiers_id: number;
	numero: string;
	total: string;
	lettre: string;
	echeance: string | null;
	communication: string | null;
}

const jour = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });

function periode(debut: string, fin: string): string {
	// `fin` is exclusive in the books; the member reads the last covered day.
	return `du ${jour.format(parseIsoDate(debut))} au ${jour.format(addUTCDays(parseIsoDate(fin), -1))}`;
}

function objetFacture(numero: string | null, type: FactureType | null, sens: FactureSens | null): string {
	const ref = numero ? ` ${numero}` : '';
	if (sens === 'recue') return `Facture${ref} (payée par le hackerspace)`;
	return `${type === 'note_de_credit' ? 'Note de crédit' : 'Facture'}${ref}`;
}

// Pure: puts every source in one list, newest first. `noms` names the organisations the member
// administers; the member's own tiers is `soi`.
export function assemblerHistorique(
	soi: number,
	noms: Map<number, string>,
	rows: { lettrages: LettrageRow[]; factures: FacturePayeeRow[]; cotisations: CotisationPayeeRow[]; dues: FactureDueRow[] }
): HistoriquePaiements {
	const pour = (tiersId: number) => (tiersId === soi ? null : (noms.get(tiersId) ?? null));
	const paiements: Paiement[] = [];

	for (const l of rows.lettrages) {
		const entree = parseMoney(l.mouvement_montant) > 0;
		const objet =
			l.cible_type === 'facture'
				? objetFacture(l.facture_numero, l.facture_type, l.facture_sens)
				: l.cible_type === 'cotisation'
					? `Cotisation ${l.cotisation_debut && l.cotisation_fin ? periode(l.cotisation_debut, l.cotisation_fin) : ''}`.trim()
					: `Note de frais — ${l.note_libelle ?? ''}`.trim();
		paiements.push({
			date: parseIsoDate(l.date),
			montant: (entree ? 1 : -1) * parseMoney(l.montant),
			objet,
			pour: pour(l.tiers_id),
			mode: l.compte_type
		});
	}

	for (const f of rows.factures) {
		if (!f.date) continue; // paid, but on no known day: nothing to place on the timeline
		const total = parseMoney(f.total);
		paiements.push({
			date: parseIsoDate(f.date),
			// An issued document is paid to the ASBL (a credit note's total is negative: a refund);
			// a received one is paid by it.
			montant: f.sens === 'emise' ? total : -Math.abs(total),
			objet: objetFacture(f.numero, f.type, f.sens),
			pour: pour(f.tiers_id),
			mode: f.importee ? 'dolibarr' : 'manuel'
		});
	}

	for (const c of rows.cotisations) {
		paiements.push({
			date: parseIsoDate(c.date ?? c.debut),
			montant: parseMoney(c.montant),
			objet: `Cotisation ${periode(c.debut, c.fin)}`,
			pour: pour(c.tiers_id),
			mode: c.importee ? 'dolibarr' : 'manuel'
		});
	}

	paiements.sort((a, b) => b.date.getTime() - a.date.getTime() || b.montant - a.montant);

	const resteDu = rows.dues
		.map((d) => {
			const total = parseMoney(d.total);
			return {
				factureId: d.id,
				numero: d.numero,
				pour: pour(d.tiers_id),
				total,
				reste: Math.round((total - parseMoney(d.lettre)) * 100) / 100,
				echeance: d.echeance ? parseIsoDate(d.echeance) : null,
				communication: d.communication
			};
		})
		.filter((d) => d.reste > 0)
		.sort((a, b) => (a.echeance?.getTime() ?? Infinity) - (b.echeance?.getTime() ?? Infinity));

	return { paiements, resteDu };
}

export async function getHistoriquePaiements(soi: number, organisations: { id: number; nom: string }[]): Promise<HistoriquePaiements> {
	const ids = [soi, ...organisations.map((o) => o.id)];
	const sql = await getDb();
	const [lettrages, factures, cotisations, dues] = await Promise.all([
		sql<LettrageRow[]>`
			SELECT COALESCE(f.tiers_id, co.tiers_id, n.tiers_id) AS tiers_id, l.montant, m.date_valeur::text AS date,
			       m.montant AS mouvement_montant, c.type AS compte_type, l.cible_type,
			       f.numero AS facture_numero, f.type AS facture_type, f.sens AS facture_sens,
			       co.debut::text AS cotisation_debut, co.fin::text AS cotisation_fin, n.libelle AS note_libelle
			FROM lettrages l
			JOIN mouvements m ON m.id = l.mouvement_id
			JOIN comptes c ON c.id = m.compte_id
			LEFT JOIN factures f ON l.cible_type = 'facture' AND f.id = l.cible_id
			LEFT JOIN cotisations co ON l.cible_type = 'cotisation' AND co.id = l.cible_id
			LEFT JOIN notes_de_frais n ON l.cible_type = 'note_de_frais' AND n.id = l.cible_id
			WHERE COALESCE(f.tiers_id, co.tiers_id, n.tiers_id) = ANY(${ids})
		`,
		// Paid with no movement behind it: marked paid by hand, or imported paid from Dolibarr (dated
		// by its issue day then, Dolibarr's payment date not being imported).
		sql<FacturePayeeRow[]>`
			SELECT f.tiers_id, COALESCE(f.numero, f.reference_externe) AS numero, f.type, f.sens, f.total,
			       COALESCE(f.payee_le, f.date_emission)::text AS date,
			       (f.dolibarr_invoice_id IS NOT NULL OR f.dolibarr_supplier_invoice_id IS NOT NULL) AS importee
			FROM factures f
			WHERE f.tiers_id = ANY(${ids}) AND f.statut = 'payee'
			  AND NOT EXISTS (SELECT 1 FROM lettrages l WHERE l.cible_type = 'facture' AND l.cible_id = f.id)
		`,
		// A cotisation paid on its own (not through an invoice, which is listed above), with no
		// movement behind it. A company's Dolibarr subscriptions are left out: Dolibarr invoiced them,
		// and those invoices are imported — listing both would count the same money twice.
		sql<CotisationPayeeRow[]>`
			SELECT co.tiers_id, co.debut::text AS debut, co.fin::text AS fin, co.montant, co.paye_le::text AS date,
			       co.dolibarr_subscription_id IS NOT NULL AS importee
			FROM cotisations co
			WHERE co.tiers_id = ANY(${ids}) AND co.statut = 'active' AND co.facture_id IS NULL AND co.montant > 0
			  AND NOT (co.dolibarr_subscription_id IS NOT NULL AND co.type = 'facturee')
			  AND NOT EXISTS (SELECT 1 FROM lettrages l WHERE l.cible_type = 'cotisation' AND l.cible_id = co.id)
		`,
		sql<FactureDueRow[]>`
			SELECT f.id, f.tiers_id, f.numero, f.total, f.date_echeance::text AS echeance, f.communication_structuree AS communication,
			       COALESCE((SELECT sum(l.montant) FROM lettrages l WHERE l.cible_type = 'facture' AND l.cible_id = f.id), 0) AS lettre
			FROM factures f
			WHERE f.tiers_id = ANY(${ids}) AND f.sens = 'emise' AND f.type = 'facture' AND f.statut = 'validee'
		`
	]);
	return assemblerHistorique(soi, new Map(organisations.map((o) => [o.id, o.nom])), { lettrages, factures, cotisations, dues });
}
