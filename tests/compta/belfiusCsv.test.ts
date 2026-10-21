import { describe, expect, it } from 'vitest';
import { BelfiusCsvError, parseBelfiusCsv, parseBelgianAmount, parseBelgianDate } from '$lib/server/compta/belfiusCsv';

// Shaped like a real Direct Net export: a preamble, then the header, then one line per movement.
const HEADER =
	"Compte;Date de comptabilisation;N° d'extrait;N° de transaction;Compte contrepartie;Nom contrepartie contient;Rue et numéro;Code postal et localité;Transaction;Date valeur;Montant;Devise;BIC;Code pays;Communications";
const PREAMBLE = ['Date début : 01/01/2026', 'Date fin : 31/03/2026', 'Compte : BE68 5390 0754 7034', 'Dernier solde : 1.234,56 EUR'];

function row(fields: Partial<Record<'extrait' | 'transaction' | 'contrepartie' | 'nom' | 'libelle' | 'date' | 'montant' | 'communication', string>>): string {
	return [
		'BE68 5390 0754 7034',
		fields.date ?? '15/01/2026',
		fields.extrait ?? '00001',
		fields.transaction ?? '0001',
		fields.contrepartie ?? 'BE71 0961 2345 6769',
		fields.nom ?? 'Jean Dupont',
		'Rue du Moulin 1',
		'4000 Liège',
		fields.libelle ?? 'VIREMENT',
		fields.date ?? '15/01/2026',
		fields.montant ?? '25,00',
		'EUR',
		'GKCCBEBB',
		'BE',
		fields.communication ?? '+++202/6000/00192+++'
	].join(';');
}

const csv = (lines: string[]) => new TextEncoder().encode(lines.join('\r\n'));

describe('parseBelgianAmount', () => {
	it('reads Belgian-formatted amounts, signed, with thousands separators', () => {
		expect(parseBelgianAmount('25,00')).toBe(25);
		expect(parseBelgianAmount('-12,5')).toBe(-12.5);
		expect(parseBelgianAmount('1.234,56')).toBe(1234.56);
		expect(parseBelgianAmount('-1.234.567,89')).toBe(-1234567.89);
		expect(parseBelgianAmount('100')).toBe(100);
		expect(parseBelgianAmount(' 1 500,00 ')).toBe(1500);
	});

	it('refuses what it cannot read rather than guessing', () => {
		expect(parseBelgianAmount('')).toBeNull();
		expect(parseBelgianAmount('abc')).toBeNull();
		expect(parseBelgianAmount('12,345')).toBeNull();
	});

	// A dot followed by one or two digits is a decimal point, not a thousands separator: reading
	// "12.50" as 1250 would put a movement a hundred times too large in the books without a word.
	it('never reads a decimal point as a thousands separator', () => {
		expect(parseBelgianAmount('12.50')).toBeNull();
		expect(parseBelgianAmount('1.5')).toBeNull();
		expect(parseBelgianAmount('1.23,45')).toBeNull();
	});
});

describe('parseBelgianDate', () => {
	it('reads dd/mm/yyyy at UTC midnight', () => {
		expect(parseBelgianDate('15/01/2026')).toEqual(new Date(Date.UTC(2026, 0, 15)));
		expect(parseBelgianDate('1.2.2026')).toEqual(new Date(Date.UTC(2026, 1, 1)));
	});

	it('refuses impossible dates instead of rolling them over', () => {
		expect(parseBelgianDate('31/02/2026')).toBeNull();
		expect(parseBelgianDate('2026-01-15')).toBeNull();
		expect(parseBelgianDate('')).toBeNull();
	});
});

describe('parseBelfiusCsv', () => {
	it('finds the header after the preamble and reads each movement', () => {
		const result = parseBelfiusCsv(
			csv([...PREAMBLE, HEADER, row({}), row({ extrait: '00002', transaction: '0007', montant: '-1.200,00', nom: 'Fournisseur SRL', communication: '' })])
		);
		expect(result.erreurs).toEqual([]);
		expect(result.compte).toBe('BE68539007547034');
		expect(result.mouvements).toHaveLength(2);
		expect(result.mouvements[0]).toEqual({
			dateValeur: new Date(Date.UTC(2026, 0, 15)),
			montant: 25,
			libelle: 'VIREMENT',
			contrepartieNom: 'Jean Dupont',
			contrepartieIban: 'BE71096123456769',
			communication: '+++202/6000/00192+++',
			externalId: '00001/0001'
		});
		expect(result.mouvements[1]).toMatchObject({ montant: -1200, contrepartieNom: 'Fournisseur SRL', communication: null, externalId: '00002/0007' });
	});

	it('decodes a Windows-1252 file (accents in names and labels)', () => {
		const text = [HEADER, row({ nom: 'Société Générale', libelle: 'Paiement reçu' })].join('\r\n');
		// Latin-1 range only, so one byte per character is exactly Windows-1252.
		const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
		const [m] = parseBelfiusCsv(bytes).mouvements;
		expect(m.contrepartieNom).toBe('Société Générale');
		expect(m.libelle).toBe('Paiement reçu');
	});

	it('keeps semicolons and quotes inside quoted fields', () => {
		const [m] = parseBelfiusCsv(csv([HEADER, row({ communication: '"Cotisation ""janvier""; merci"' })])).mouvements;
		expect(m.communication).toBe('Cotisation "janvier"; merci');
	});

	it('collapses the padding Belfius puts in the transaction text', () => {
		const [m] = parseBelfiusCsv(csv([HEADER, row({ libelle: 'VIREMENT     EUROPEEN    DE   JEAN' })])).mouvements;
		expect(m.libelle).toBe('VIREMENT EUROPEEN DE JEAN');
	});

	it('reports an unreadable line by number and keeps reading the rest', () => {
		const result = parseBelfiusCsv(csv([HEADER, row({}), row({ montant: 'n/a', transaction: '0002' }), row({ transaction: '0003' })]));
		expect(result.mouvements.map((m) => m.externalId)).toEqual(['00001/0001', '00001/0003']);
		expect(result.erreurs).toEqual(['Ligne 3 : montant ou date illisible.']);
	});

	it('finds columns by their headings, whatever their order', () => {
		const header = 'Montant;Communications;Date valeur;Nom contrepartie contient;Transaction';
		const [m] = parseBelfiusCsv(csv([header, '-9,99;Abonnement;03/02/2026;Hébergeur;DOMICILIATION'])).mouvements;
		expect(m).toMatchObject({ montant: -9.99, communication: 'Abonnement', contrepartieNom: 'Hébergeur', libelle: 'DOMICILIATION' });
		expect(m.dateValeur).toEqual(new Date(Date.UTC(2026, 1, 3)));
	});

	// Without statement and transaction numbers the id is a hash of the line's content: the same
	// period exported twice must give the same ids, or a re-import would duplicate every movement.
	it('gives the same id to the same line across two exports when there is no transaction number', () => {
		const header = 'Date valeur;Montant;Transaction;Communications';
		const line = '15/01/2026;25,00;VIREMENT;+++202/6000/00192+++';
		const first = parseBelfiusCsv(csv([header, line])).mouvements[0].externalId;
		const second = parseBelfiusCsv(csv(['Une autre ligne de préambule', header, line])).mouvements[0].externalId;
		expect(first).toMatch(/^h:[0-9a-f]{20}$/);
		expect(second).toBe(first);
		expect(parseBelfiusCsv(csv([header, '15/01/2026;25,01;VIREMENT;+++202/6000/00192+++'])).mouvements[0].externalId).not.toBe(first);
	});

	it('refuses a file that is not a Belfius export', () => {
		expect(() => parseBelfiusCsv(csv(['nom,prenom', 'Dupont,Jean']))).toThrow(BelfiusCsvError);
	});
});
