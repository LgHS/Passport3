import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { montantsPatrimoine, renderComptesAnnuelsPdf, SAISIE_VIDE } from '$lib/server/compta/comptesAnnuels';
import { estSoldeInitial } from '$lib/server/compta/importDolibarr';
import type { Journal } from '$lib/server/compta/journal';
import { parseRubrique, rubriqueParDefaut } from '$lib/rubriques';

const journal: Journal = {
	annee: 2026,
	lignes: [],
	recettes: { cotisations: 4200, dons_legs: 150, subsides: 0, autres_recettes: 1300.5, marchandises_services: 0, remunerations: 0, services_biens_divers: 0, autres_depenses: 0, non_lettre: 0 },
	depenses: { cotisations: 0, dons_legs: 0, subsides: 0, autres_recettes: 0, marchandises_services: 320, remunerations: 0, services_biens_divers: 3890.25, autres_depenses: 45, non_lettre: 0 },
	totalRecettes: 5650.5,
	totalDepenses: 4255.25,
	resultat: 1395.25,
	patrimoine: {
		date: new Date('2026-12-31T00:00:00Z'),
		comptes: [{ nom: 'Banque', type: 'banque', solde: 18000 }],
		totalComptes: 18000,
		creances: 450,
		dettesFournisseurs: 120,
		dettesFrais: 35.5
	}
};

const settings = {
	delaiGraceJours: 90,
	emetteurNom: 'Liège Hackerspace ASBL',
	emetteurAdresse: 'Rue Exemple 1\n4000 Liège',
	emetteurNumeroEntreprise: '0000.000.000',
	emetteurEmail: 'compta@exemple.test',
	emetteurIban: '',
	mentionTva: '',
	delaiPaiementJours: 30,
	desactivationAuto: false,
	receptionDomaines: 'doccle.be',
	receptionAuto: false,
	rappelDelaiJours: 14
};

describe('montantsPatrimoine', () => {
	it('takes liquidités, créances and dettes from the books, and adds what was typed', () => {
		const m = montantsPatrimoine(journal, { ...SAISIE_VIDE, montants: { machines_propres: 2500, creances: -50, autres_dettes: 10 } });
		const by = (key: string) => [...m.avoirs, ...m.dettes].find((l) => l.key === key)!.montant;
		expect(by('liquidites')).toBe(18000);
		expect(by('creances')).toBe(400);
		expect(by('machines_propres')).toBe(2500);
		expect(by('dettes_membres')).toBe(35.5);
		expect(m.totalAvoirs).toBe(20900);
		expect(m.totalDettes).toBe(165.5);
	});

	it('gives headings no amount of their own', () => {
		const m = montantsPatrimoine(journal, { ...SAISIE_VIDE, montants: { immeubles: 999 } });
		expect(m.avoirs.find((l) => l.key === 'immeubles')!.montant).toBe(0);
	});
});

describe('renderComptesAnnuelsPdf', () => {
	it('renders a PDF', async () => {
		const pdf = await renderComptesAnnuelsPdf(
			journal,
			{
				annee: 2026,
				updatedAt: null,
				updatedBy: null,
				...SAISIE_VIDE,
				reglesEvaluation: 'Les avoirs sont évalués à leur valeur d’acquisition. Les machines sont amorties sur cinq ans.',
				montants: { machines_propres: 2500 },
				approuvesLe: new Date('2027-03-14T00:00:00Z')
			},
			settings
		);
		expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
		expect(pdf.length).toBeGreaterThan(2000);
		if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
	});
});

describe('rubriques', () => {
	it('defaults each kind of document to a heading of the right side', () => {
		expect(rubriqueParDefaut({ type: 'cotisation', cotisationType: 'libre' })).toBe('cotisations');
		expect(rubriqueParDefaut({ type: 'cotisation', cotisationType: 'sponsoring' })).toBe('autres_recettes');
		expect(rubriqueParDefaut({ type: 'facture', sens: 'emise', cotisationType: 'facturee' })).toBe('cotisations');
		expect(rubriqueParDefaut({ type: 'facture', sens: 'emise', cotisationType: null })).toBe('autres_recettes');
		expect(rubriqueParDefaut({ type: 'facture', sens: 'recue' })).toBe('services_biens_divers');
		expect(rubriqueParDefaut({ type: 'note_de_frais' })).toBe('services_biens_divers');
		expect(rubriqueParDefaut({ type: 'autre', montant: -12 })).toBe('autres_depenses');
		expect(rubriqueParDefaut({ type: 'autre', montant: 12 })).toBe('autres_recettes');
	});

	it('only accepts a heading of the side asked for', () => {
		expect(parseRubrique('subsides', 'recette')).toBe('subsides');
		expect(parseRubrique('subsides', 'depense')).toBeNull();
		expect(parseRubrique('non_lettre', 'recette')).toBeNull();
		expect(parseRubrique('', 'depense')).toBeNull();
	});
});

describe('estSoldeInitial', () => {
	it('recognises Dolibarr’s opening balance line', () => {
		expect(estSoldeInitial('Solde initial')).toBe(true);
		expect(estSoldeInitial('(Solde initial)')).toBe(true);
		expect(estSoldeInitial(' (InitialBankBalance) ')).toBe(true);
		expect(estSoldeInitial('Solde initial de la caisse du bar')).toBe(false);
		expect(estSoldeInitial(null)).toBe(false);
	});
});
