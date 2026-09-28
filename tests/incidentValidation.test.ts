import { describe, expect, it } from 'vitest';
import { validateIncidentSubmission } from '$lib/server/incidentValidation';
import { DESCRIPTION_MAX_LENGTH } from '$lib/incidentDisplay';

// A `datetime-local` field submits the member's wall clock ("2026-09-28T16:39"), with no timezone —
// the same string the page's own localNow() builds. Building these with toISOString() would produce
// UTC digits, which the validator then (correctly) reads as local time and shifts by the UTC
// offset — the test would end up asserting something other than what it claims to.
function localInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function submission(overrides: Record<string, string> = {}): FormData {
	const formData = new FormData();
	const fields = {
		kind: 'incident',
		occurredAt: localInput(new Date(Date.now() - 60_000)),
		people: 'Loïc',
		description: 'La laser a fumé.',
		...overrides
	};
	for (const [key, value] of Object.entries(fields)) {
		// An empty string stands for "field left blank"; a checkbox that isn't ticked isn't sent at
		// all, which is what omitting the key reproduces.
		if (value !== '') formData.append(key, value);
	}
	return formData;
}

describe('validateIncidentSubmission', () => {
	it('accepte une déclaration minimale', () => {
		const result = validateIncidentSubmission(submission());
		expect(result.ok).toBe(true);
	});

	it('exige les personnes impliquées', () => {
		expect(validateIncidentSubmission(submission({ people: '' })).ok).toBe(false);
	});

	it('exige une description', () => {
		expect(validateIncidentSubmission(submission({ description: '' })).ok).toBe(false);
	});

	it('exige une date', () => {
		expect(validateIncidentSubmission(submission({ occurredAt: '' })).ok).toBe(false);
	});

	it('refuse une date dans le futur', () => {
		const future = localInput(new Date(Date.now() + 60 * 60_000));
		expect(validateIncidentSubmission(submission({ occurredAt: future })).ok).toBe(false);
	});

	it('tolère une horloge légèrement en avance', () => {
		// The form pre-fills the moment it was opened; a few seconds of clock skew between the
		// member's machine and the server must not reject a declaration sent straight away.
		const slightlyAhead = localInput(new Date(Date.now() + 20_000));
		expect(validateIncidentSubmission(submission({ occurredAt: slightlyAhead })).ok).toBe(true);
	});

	it('refuse un type hors vocabulaire', () => {
		expect(validateIncidentSubmission(submission({ kind: 'autre' })).ok).toBe(false);
	});

	it('refuse une description trop longue', () => {
		const tooLong = 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1);
		expect(validateIncidentSubmission(submission({ description: tooLong })).ok).toBe(false);
	});

	describe('cases à cocher et leur champ de détail', () => {
		it("refuse l'anti-incendie coché sans détail", () => {
			expect(validateIncidentSubmission(submission({ fireDeviceUsed: 'on' })).ok).toBe(false);
		});

		it("accepte l'anti-incendie coché avec détail", () => {
			const result = validateIncidentSubmission(
				submission({ fireDeviceUsed: 'on', fireDeviceDetails: 'extincteur CO2' })
			);
			expect(result.ok && result.input.fireDeviceUsed).toBe(true);
			expect(result.ok && result.input.fireDeviceDetails).toBe('extincteur CO2');
		});

		it('efface un détail resté du formulaire quand la case est décochée', () => {
			// A member can tick, type, untick, then submit — the stale text must not be stored.
			const result = validateIncidentSubmission(
				submission({ fireDeviceDetails: 'texte resté du formulaire' })
			);
			expect(result.ok && result.input.fireDeviceUsed).toBe(false);
			expect(result.ok && result.input.fireDeviceDetails).toBe(null);
		});

		it('remonte les cases visiteur et secours', () => {
			const result = validateIncidentSubmission(
				submission({ visitorInvolved: 'on', emergencyServicesCalled: 'on' })
			);
			expect(result.ok && result.input.visitorInvolved).toBe(true);
			expect(result.ok && result.input.emergencyServicesCalled).toBe(true);
		});
	});

	describe('trousse de secours, réservée aux accidents', () => {
		it('ignore la trousse sur un incident, même soumise de force', () => {
			// The field isn't rendered for an incident, but a crafted submission can still carry it.
			const result = validateIncidentSubmission(
				submission({ firstAidUsed: 'on', firstAidDetails: 'compresses' })
			);
			expect(result.ok && result.input.firstAidUsed).toBe(false);
			expect(result.ok && result.input.firstAidDetails).toBe(null);
		});

		it('accepte la trousse sur un accident', () => {
			const result = validateIncidentSubmission(
				submission({ kind: 'accident', firstAidUsed: 'on', firstAidDetails: 'compresses' })
			);
			expect(result.ok && result.input.firstAidUsed).toBe(true);
			expect(result.ok && result.input.firstAidDetails).toBe('compresses');
		});

		it('refuse la trousse cochée sans détail sur un accident', () => {
			const result = validateIncidentSubmission(submission({ kind: 'accident', firstAidUsed: 'on' }));
			expect(result.ok).toBe(false);
		});
	});
});
