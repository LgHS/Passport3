// Client-safe (imported from both the server validator and the Svelte page), same single-sourcing
// as wishlistDisplay.ts — the vocabulary lives here and nowhere else.
export type IncidentKind = 'incident' | 'accident';

// The definitions are part of the data, not just form decoration: the whole point of asking for a
// kind is that people agree on what each one means, so the form shows these verbatim.
export const INCIDENT_KINDS: {
	value: IncidentKind;
	label: string;
	icon: string;
	definition: string;
}[] = [
	{
		value: 'incident',
		label: 'Incident',
		icon: '⚠️',
		definition:
			"Une casse machine, un dégât, ou un événement qui n'a causé aucune blessure mais aurait pu entraîner de graves conséquences."
	},
	{
		value: 'accident',
		label: 'Accident',
		icon: '🚑',
		definition: 'Un événement soudain et imprévu qui a causé une blessure.'
	}
];

export function kindMeta(kind: IncidentKind) {
	return INCIDENT_KINDS.find((k) => k.value === kind) ?? INCIDENT_KINDS[0];
}

// Field limits live here rather than in the server validator so the form's `maxlength` and the
// server's check read the same constant — importing $lib/server/* from a Svelte page isn't allowed,
// and copying the numbers into the page (as the wishlist does) lets them drift apart.
export const PEOPLE_MAX_LENGTH = 300;
export const WITNESSES_MAX_LENGTH = 300;
export const EQUIPMENT_MAX_LENGTH = 300;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const DETAILS_MAX_LENGTH = 300;
