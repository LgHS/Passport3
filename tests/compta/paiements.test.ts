import { describe, expect, it } from 'vitest';
import { assemblerHistorique, type LettrageRow } from '$lib/server/compta/paiements';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const SOI = 1;
const SOCIETE = 2;
const noms = new Map([[SOCIETE, 'Atelier SRL']]);
const vide = { lettrages: [], factures: [], cotisations: [], dues: [] };

function lettrage(extra: Partial<LettrageRow>): LettrageRow {
	return {
		tiers_id: SOI,
		montant: '50.00',
		date: '2026-03-10',
		mouvement_montant: '50.00',
		compte_type: 'banque',
		cible_type: 'facture',
		facture_numero: '2026-0004',
		facture_type: 'facture',
		facture_sens: 'emise',
		cotisation_debut: null,
		cotisation_fin: null,
		note_libelle: null,
		...extra
	};
}

describe('assemblerHistorique', () => {
	it('dates an allocation by its movement and says what it paid', () => {
		const { paiements } = assemblerHistorique(SOI, noms, { ...vide, lettrages: [lettrage({})] });
		expect(paiements).toEqual([{ date: day('2026-03-10'), montant: 50, objet: 'Facture 2026-0004', pour: null, mode: 'banque' }]);
	});

	it('counts money paid back by the hackerspace as negative', () => {
		const { paiements } = assemblerHistorique(SOI, noms, {
			...vide,
			lettrages: [lettrage({ cible_type: 'note_de_frais', mouvement_montant: '-18.40', montant: '18.40', note_libelle: 'Filament', compte_type: 'caisse' })]
		});
		expect(paiements[0]).toMatchObject({ montant: -18.4, objet: 'Note de frais — Filament', mode: 'caisse' });
	});

	it('names the cotisation’s period with its last covered day', () => {
		const { paiements } = assemblerHistorique(SOI, noms, {
			...vide,
			lettrages: [lettrage({ cible_type: 'cotisation', cotisation_debut: '2026-01-01', cotisation_fin: '2027-01-01' })]
		});
		expect(paiements[0].objet.replace(/\s/g, ' ')).toBe('Cotisation du 1 janv. 2026 au 31 déc. 2026');
	});

	it('names the company a payment was for', () => {
		const { paiements } = assemblerHistorique(SOI, noms, { ...vide, lettrages: [lettrage({ tiers_id: SOCIETE })] });
		expect(paiements[0].pour).toBe('Atelier SRL');
	});

	it('includes what was paid with no movement: by hand, or imported from Dolibarr', () => {
		const { paiements } = assemblerHistorique(SOI, noms, {
			...vide,
			factures: [
				{ tiers_id: SOI, numero: 'FA2025-0012', type: 'facture', sens: 'emise', total: '30.00', date: '2025-05-02', importee: true },
				{ tiers_id: SOI, numero: '2026-0009', type: 'note_de_credit', sens: 'emise', total: '-30.00', date: '2026-02-01', importee: false },
				{ tiers_id: SOI, numero: 'paid-nowhere', type: 'facture', sens: 'emise', total: '10.00', date: null, importee: false }
			],
			cotisations: [{ tiers_id: SOI, debut: '2025-01-01', fin: '2026-01-01', montant: '120.00', date: null, importee: true }]
		});
		expect(paiements.map((p) => [p.objet.slice(0, 15), p.montant, p.mode])).toEqual([
			['Note de crédit ', -30, 'manuel'],
			['Facture FA2025-', 30, 'dolibarr'],
			['Cotisation du 1', 120, 'dolibarr']
		]);
		// With no payment date of its own, a Dolibarr subscription sits at its start.
		expect(paiements[2].date).toEqual(day('2025-01-01'));
	});

	it('lists the newest first', () => {
		const { paiements } = assemblerHistorique(SOI, noms, {
			...vide,
			lettrages: [lettrage({ date: '2025-01-05' }), lettrage({ date: '2026-07-01' }), lettrage({ date: '2025-11-30' })]
		});
		expect(paiements.map((p) => p.date)).toEqual([day('2026-07-01'), day('2025-11-30'), day('2025-01-05')]);
	});

	it('keeps only invoices with something left to pay, soonest due first', () => {
		const { resteDu } = assemblerHistorique(SOI, noms, {
			...vide,
			dues: [
				{ id: 1, tiers_id: SOI, numero: '2026-0010', total: '100.00', lettre: '100.00', echeance: '2026-04-01', communication: null },
				{ id: 2, tiers_id: SOCIETE, numero: '2026-0011', total: '300.00', lettre: '120.00', echeance: '2026-05-01', communication: '+++202/6000/01170+++' },
				{ id: 3, tiers_id: SOI, numero: '2026-0012', total: '20.00', lettre: '0', echeance: '2026-03-01', communication: null }
			]
		});
		expect(resteDu.map((d) => [d.numero, d.reste, d.pour])).toEqual([
			['2026-0012', 20, null],
			['2026-0011', 180, 'Atelier SRL']
		]);
	});
});
