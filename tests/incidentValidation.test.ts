import { describe, expect, it } from 'vitest';
import { validateIncidentSubmission } from '$lib/server/incidentValidation';
import { DESCRIPTION_MAX_LENGTH } from '$lib/incidentDisplay';
import { brusselsNowInput, parseBrusselsDateTime } from '$lib/brusselsTime';

// A `datetime-local` field submits a wall-clock time ("2026-09-28T16:39") with no timezone, which
// the validator reads as Brussels time — the same string the page's own localNow() builds. Built
// with brusselsNowInput() so the tests hold whatever timezone they run in.
const localInput = (date: Date) => brusselsNowInput(date);

function submission(overrides: Record<string, string> = {}): FormData {
	const formData = new FormData();
	const fields = {
		kind: 'incident',
		occurredAt: localInput(new Date(Date.now() - 60_000)),
		people: 'Loïc',
		description: 'La laser a fumé.',
		certified: 'on',
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

	it('exige la certification sur l’honneur', () => {
		expect(validateIncidentSubmission(submission({ certified: '' })).ok).toBe(false);
	});

	it("lit l'heure comme heure de Bruxelles, quel que soit le fuseau du serveur", () => {
		// The Docker image runs in UTC: reading "12:00" in the server's timezone would store it one
		// or two hours late, and reject a form pre-filled with "now" as being in the future.
		const result = validateIncidentSubmission(submission({ occurredAt: '2026-07-01T12:00' }));
		expect(result.ok && result.input.occurredAt.toISOString()).toBe('2026-07-01T10:00:00.000Z');
		const winter = validateIncidentSubmission(submission({ occurredAt: '2026-01-15T12:00' }));
		expect(winter.ok && winter.input.occurredAt.toISOString()).toBe('2026-01-15T11:00:00.000Z');
	});

	it('refuse un type hors vocabulaire', () => {
		expect(validateIncidentSubmission(submission({ kind: 'autre' })).ok).toBe(false);
	});

	it('refuse une description trop longue', () => {
		const tooLong = 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1);
		expect(validateIncidentSubmission(submission({ description: tooLong })).ok).toBe(false);
	});

	it('accepte la valeur multi-ligne produite par le champ à tags', () => {
		// TagInput submits its chips through a hidden field as newline-separated text; the validator
		// treats it as plain text and must keep the separators intact, since the admin list splits on
		// them again to render the chips back.
		const result = validateIncidentSubmission(
			submission({ people: 'Alice\nBob', witnesses: 'Carol\nDave' })
		);
		expect(result.ok && result.input.people).toBe('Alice\nBob');
		expect(result.ok && result.input.witnesses).toBe('Carol\nDave');
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

describe('brusselsTime', () => {
	it('fait l’aller-retour autour des changements d’heure', () => {
		// Around both 2026 changes. Not 00:30Z/01:30Z on 25 October: both are 02:30 in Brussels (the
		// hour that happens twice), so no wall-clock value can tell them apart.
		for (const iso of ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '2026-10-24T23:30:00Z', '2026-10-25T02:30:00Z']) {
			const instant = new Date(iso);
			expect(parseBrusselsDateTime(brusselsNowInput(instant))?.toISOString()).toBe(instant.toISOString());
		}
	});

	it('refuse un format inattendu', () => {
		expect(parseBrusselsDateTime('28/09/2026 16:39')).toBe(null);
	});
});
