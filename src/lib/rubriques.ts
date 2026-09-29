// The headings of the official statement of receipts and expenses — "schéma minimum normalisé"
// for small associations keeping simplified accounts (arrêté royal du 29 avril 2019, annexe 8).
// Client-safe: shared by the server (journal.ts) and the pages' selects.

export const RUBRIQUES_RECETTES = ['cotisations', 'dons_legs', 'subsides', 'autres_recettes'] as const;
export const RUBRIQUES_DEPENSES = ['marchandises_services', 'remunerations', 'services_biens_divers', 'autres_depenses'] as const;

export type RubriqueRecette = (typeof RUBRIQUES_RECETTES)[number];
export type RubriqueDepense = (typeof RUBRIQUES_DEPENSES)[number];
export type RubriqueOfficielle = RubriqueRecette | RubriqueDepense;
// 'non_lettre' is ours, not the model's: what hasn't been matched yet, to qualify before closing.
export type Rubrique = RubriqueOfficielle | 'non_lettre';

export const RUBRIQUE_LABEL: Record<Rubrique, string> = {
	cotisations: 'Cotisations',
	dons_legs: 'Dons et legs',
	subsides: 'Subsides',
	autres_recettes: 'Autres recettes',
	marchandises_services: 'Marchandises et services',
	remunerations: 'Rémunérations',
	services_biens_divers: 'Services et biens divers',
	autres_depenses: 'Autres dépenses',
	non_lettre: 'Non lettré'
};

// What each heading is for, as the SPF Justice's guide describes them.
export const RUBRIQUE_AIDE: Record<RubriqueOfficielle, string> = {
	cotisations: 'Cotisations des membres et adhérents.',
	dons_legs: 'Dons et legs, sans contrepartie.',
	subsides: 'Subsides des pouvoirs publics.',
	autres_recettes: 'Ventes, prestations, sponsoring avec contrepartie, intérêts…',
	marchandises_services: 'Achats de marchandises et de services nécessaires à l’activité ou destinés à la revente.',
	remunerations: 'Rémunérations et charges sociales.',
	services_biens_divers: 'Frais généraux : loyer, énergie, télécoms, assurances, entretien…',
	autres_depenses: 'Tout ce qui ne relève pas des autres rubriques : taxes, frais bancaires…'
};

export function estRecette(r: string): r is RubriqueRecette {
	return (RUBRIQUES_RECETTES as readonly string[]).includes(r);
}
export function estDepense(r: string): r is RubriqueDepense {
	return (RUBRIQUES_DEPENSES as readonly string[]).includes(r);
}

// A heading posted by a form, for the given side; null when it isn't one (or is empty, meaning
// "the default").
export function parseRubrique(value: unknown, sens: 'recette' | 'depense'): RubriqueOfficielle | null {
	if (typeof value !== 'string') return null;
	return (sens === 'recette' ? estRecette(value) : estDepense(value)) ? (value as RubriqueOfficielle) : null;
}

// The heading a document falls under when the treasurer chose none.
export function rubriqueParDefaut(doc: {
	type: 'facture' | 'cotisation' | 'note_de_frais' | 'autre';
	// facture: 'emise' | 'recue'
	sens?: string | null;
	// facture: its dues block ('facturee' | 'sponsoring'); cotisation: its type.
	cotisationType?: string | null;
	// autre: the sign of the movement.
	montant?: number;
}): RubriqueOfficielle {
	switch (doc.type) {
		case 'cotisation':
			return doc.cotisationType === 'sponsoring' ? 'autres_recettes' : 'cotisations';
		case 'note_de_frais':
			return 'services_biens_divers';
		case 'facture':
			if (doc.sens === 'recue') return 'services_biens_divers';
			return doc.cotisationType === 'facturee' ? 'cotisations' : 'autres_recettes';
		default:
			return (doc.montant ?? 0) >= 0 ? 'autres_recettes' : 'autres_depenses';
	}
}
