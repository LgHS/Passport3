import {
	INCIDENT_KINDS,
	PEOPLE_MAX_LENGTH,
	WITNESSES_MAX_LENGTH,
	EQUIPMENT_MAX_LENGTH,
	DESCRIPTION_MAX_LENGTH,
	DETAILS_MAX_LENGTH,
	type IncidentKind
} from '$lib/incidentDisplay';
import type { IncidentInput } from '$lib/server/incidents';

export type IncidentValidationResult =
	| { ok: true; input: IncidentInput }
	| { ok: false; error: string };

const VALID_KINDS = INCIDENT_KINDS.map((k) => k.value);

// A checkbox and its follow-up field always travel together: checked means the detail is required,
// unchecked means the detail is forced to null rather than whatever the form happened to still
// carry (a member can tick, type, untick, and submit — the stale text must not be stored).
function checkboxWithDetails(
	formData: FormData,
	checkboxField: string,
	detailsField: string,
	missingDetailsError: string
): { ok: true; used: boolean; details: string | null } | { ok: false; error: string } {
	const used = formData.has(checkboxField);
	if (!used) return { ok: true, used: false, details: null };

	const details = String(formData.get(detailsField) ?? '').trim();
	if (!details) return { ok: false, error: missingDetailsError };
	if (details.length > DETAILS_MAX_LENGTH) {
		return { ok: false, error: `Ce champ ne peut pas dépasser ${DETAILS_MAX_LENGTH} caractères.` };
	}
	return { ok: true, used: true, details };
}

export function validateIncidentSubmission(formData: FormData): IncidentValidationResult {
	const kind = String(formData.get('kind') ?? '').trim();
	if (!VALID_KINDS.includes(kind as IncidentKind)) {
		return { ok: false, error: 'Type de déclaration invalide.' };
	}

	const occurredAtRaw = String(formData.get('occurredAt') ?? '').trim();
	if (!occurredAtRaw) {
		return { ok: false, error: "La date et l'heure sont obligatoires." };
	}
	const occurredAt = new Date(occurredAtRaw);
	if (Number.isNaN(occurredAt.getTime())) {
		return { ok: false, error: "Date et heure invalides." };
	}
	// A minute of slack rather than a strict comparison: the form pre-fills the time it was opened,
	// and a clock skew of a few seconds between the member's machine and the server shouldn't
	// reject a declaration submitted immediately.
	if (occurredAt.getTime() > Date.now() + 60_000) {
		return { ok: false, error: "La date ne peut pas être dans le futur." };
	}

	const people = String(formData.get('people') ?? '').trim();
	if (!people) {
		return { ok: false, error: 'Indiquez les personnes impliquées.' };
	}
	if (people.length > PEOPLE_MAX_LENGTH) {
		return { ok: false, error: `Les personnes impliquées ne peuvent pas dépasser ${PEOPLE_MAX_LENGTH} caractères.` };
	}

	const witnesses = String(formData.get('witnesses') ?? '').trim();
	if (witnesses.length > WITNESSES_MAX_LENGTH) {
		return { ok: false, error: `Les témoins ne peuvent pas dépasser ${WITNESSES_MAX_LENGTH} caractères.` };
	}

	const equipment = String(formData.get('equipment') ?? '').trim();
	if (equipment.length > EQUIPMENT_MAX_LENGTH) {
		return { ok: false, error: `Le matériel impliqué ne peut pas dépasser ${EQUIPMENT_MAX_LENGTH} caractères.` };
	}

	const description = String(formData.get('description') ?? '').trim();
	if (!description) {
		return { ok: false, error: 'La description ne peut pas être vide.' };
	}
	if (description.length > DESCRIPTION_MAX_LENGTH) {
		return { ok: false, error: `La description ne peut pas dépasser ${DESCRIPTION_MAX_LENGTH} caractères.` };
	}

	// First aid is an accident-only question: the field isn't rendered for an incident, but a
	// crafted submission could still carry it, so it's dropped here rather than trusted.
	const firstAid =
		kind === 'accident'
			? checkboxWithDetails(
					formData,
					'firstAidUsed',
					'firstAidDetails',
					'Indiquez ce qui a été utilisé dans la trousse de secours.'
				)
			: ({ ok: true, used: false, details: null } as const);
	if (!firstAid.ok) return { ok: false, error: firstAid.error };

	const fireDevice = checkboxWithDetails(
		formData,
		'fireDeviceUsed',
		'fireDeviceDetails',
		"Indiquez quel dispositif anti-incendie a été utilisé."
	);
	if (!fireDevice.ok) return { ok: false, error: fireDevice.error };

	return {
		ok: true,
		input: {
			kind: kind as IncidentKind,
			occurredAt,
			people,
			visitorInvolved: formData.has('visitorInvolved'),
			witnesses: witnesses || null,
			equipment: equipment || null,
			description,
			emergencyServicesCalled: formData.has('emergencyServicesCalled'),
			firstAidUsed: firstAid.used,
			firstAidDetails: firstAid.details,
			fireDeviceUsed: fireDevice.used,
			fireDeviceDetails: fireDevice.details
		}
	};
}
