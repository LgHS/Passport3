// The lines of the official statement of assets ("état du patrimoine") and of the rights and
// commitments table — same model as $lib/rubriques.ts. Client-safe.
//
// `calcule` lines come from the books (bank balances, unpaid invoices, accepted expense claims);
// the amount typed for them is an adjustment added to what the books say. The others are what
// only the inventory knows, typed as is.

export interface LignePatrimoine {
	key: string;
	label: string;
	// Indented under the previous non-indented line ("appartenant à l'association en pleine propriété").
	sousLigne?: boolean;
	// Heading of sub-lines, without an amount of its own.
	titre?: boolean;
	calcule?: 'liquidites' | 'creances' | 'dettes_fournisseurs' | 'dettes_membres';
}

const propriete = (prefix: string): LignePatrimoine[] => [
	{ key: `${prefix}_propres`, label: 'appartenant à l’association en pleine propriété', sousLigne: true },
	{ key: `${prefix}_autres`, label: 'autres', sousLigne: true }
];

export const AVOIRS: LignePatrimoine[] = [
	{ key: 'immeubles', label: 'Immeubles (terrains, …)', titre: true },
	...propriete('immeubles'),
	{ key: 'machines', label: 'Machines', titre: true },
	...propriete('machines'),
	{ key: 'mobilier', label: 'Mobilier et matériel roulant', titre: true },
	...propriete('mobilier'),
	{ key: 'stocks', label: 'Stocks' },
	{ key: 'creances', label: 'Créances', calcule: 'creances' },
	{ key: 'placements', label: 'Placements de trésorerie' },
	{ key: 'liquidites', label: 'Liquidités', calcule: 'liquidites' },
	{ key: 'autres_actifs', label: 'Autres actifs' }
];

export const DETTES: LignePatrimoine[] = [
	{ key: 'dettes_financieres', label: 'Dettes financières' },
	{ key: 'dettes_fournisseurs', label: 'Dettes à l’égard des fournisseurs', calcule: 'dettes_fournisseurs' },
	{ key: 'dettes_membres', label: 'Dettes à l’égard des membres', calcule: 'dettes_membres' },
	{ key: 'dettes_fiscales', label: 'Dettes fiscales, salariales et sociales' },
	{ key: 'autres_dettes', label: 'Autres dettes' }
];

export const DROITS: LignePatrimoine[] = [
	{ key: 'subsides_promis', label: 'Subsides promis' },
	{ key: 'dons_promis', label: 'Dons promis' },
	{ key: 'autres_droits', label: 'Autres droits' }
];

export const ENGAGEMENTS: LignePatrimoine[] = [
	{ key: 'hypotheques', label: 'Hypothèques et promesses d’hypothèque' },
	{ key: 'garanties', label: 'Garanties données' },
	{ key: 'autres_engagements', label: 'Autres engagements' }
];

export const LIGNES_SAISIES: string[] = [...AVOIRS, ...DETTES, ...DROITS, ...ENGAGEMENTS].filter((l) => !l.titre).map((l) => l.key);
