import { describe, expect, it } from 'vitest';
import { echeanceRappel, texteRappel } from '$lib/server/compta/rappels';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('echeanceRappel', () => {
	it('proposes a first reminder once the delay after the due date has passed', () => {
		expect(echeanceRappel(day('2026-09-01'), null, day('2026-09-14'), 14)).toEqual({ aRelancer: false, prochainRappel: day('2026-09-15') });
		expect(echeanceRappel(day('2026-09-01'), null, day('2026-09-15'), 14)).toEqual({ aRelancer: true, prochainRappel: null });
	});

	it('counts again from the last reminder', () => {
		expect(echeanceRappel(day('2026-09-01'), day('2026-09-15'), day('2026-09-20'), 14)).toEqual({
			aRelancer: false,
			prochainRappel: day('2026-09-29')
		});
		expect(echeanceRappel(day('2026-09-01'), day('2026-09-15'), day('2026-09-29'), 14).aRelancer).toBe(true);
	});

	it('never proposes before the day after the due date, even with no delay', () => {
		expect(echeanceRappel(day('2026-09-01'), null, day('2026-09-01'), 0)).toEqual({ aRelancer: false, prochainRappel: day('2026-09-02') });
		expect(echeanceRappel(day('2026-09-01'), null, day('2026-09-02'), 0).aRelancer).toBe(true);
	});
});

describe('texteRappel', () => {
	const facture = {
		numero: '2026-0007',
		tiersNom: 'Exemple SRL',
		dateEmission: day('2026-08-01'),
		dateEcheance: day('2026-08-31'),
		total: 300,
		reste: 300,
		communicationStructuree: '+++202/6000/00707+++',
		dernierRappel: null
	};
	const settings = { emetteurNom: 'Liège Hackerspace ASBL', emetteurEmail: 'compta@exemple.test', emetteurIban: 'BE00 0000 0000 0000', mentionTva: 'Franchise TVA' };

	it('states the invoice, what is owed and how to pay', () => {
		const { subject, text } = texteRappel(facture, 1, settings);
		expect(subject).toBe('Rappel — facture 2026-0007 — Liège Hackerspace ASBL');
		expect(text).toContain('Sauf erreur de notre part');
		expect(text).toContain('facture 2026-0007');
		expect(text).toContain('+++202/6000/00707+++');
		expect(text).toContain('BE00 0000 0000 0000');
		expect(text).toContain('Franchise TVA');
		expect(text).toMatch(/Montant à payer : 300,00\s€/);
	});

	it('says what remains after a partial payment', () => {
		expect(texteRappel({ ...facture, reste: 120 }, 1, settings).text).toMatch(/il reste 120,00\s€ à payer/);
	});

	it('hardens with the rank', () => {
		const deux = texteRappel({ ...facture, dernierRappel: day('2026-09-15') }, 2, settings);
		expect(deux.subject).toMatch(/^Deuxième rappel/);
		expect(deux.text).toContain('Malgré notre rappel du 15 septembre 2026');
		expect(texteRappel(facture, 3, settings).subject).toMatch(/^Dernier rappel/);
		expect(texteRappel(facture, 5, settings).subject).toMatch(/^Dernier rappel/);
	});

	it('adds the treasurer’s own words', () => {
		expect(texteRappel(facture, 1, settings, '  Merci de nous contacter.  ').text).toContain('\nMerci de nous contacter.\n');
	});
});
