import { describe, expect, it } from 'vitest';
import {
	computeSituation,
	detectCotisationGaps,
	mergePeriodes,
	missingMonthsInGap,
	type CotisationHistorique
} from '$lib/server/compta/cotisations';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// `end` is inclusive here, like the history the pages show.
function cotisation(start: string, end: string, extra: Partial<CotisationHistorique> = {}): CotisationHistorique {
	return { id: 1, start: day(start), end: day(end), amount: 20, type: 'libre', statut: 'active', via: null, ...extra };
}

const member = { exempteCotisation: false };
const GRACE = 90;

describe('mergePeriodes', () => {
	it('joins back-to-back periods (exclusive ends) and overlapping ones', () => {
		expect(
			mergePeriodes([
				{ debut: day('2026-03-01'), fin: day('2026-04-01') },
				{ debut: day('2026-01-01'), fin: day('2026-02-01') },
				{ debut: day('2026-02-01'), fin: day('2026-03-15') }
			])
		).toEqual([{ debut: day('2026-01-01'), fin: day('2026-04-01') }]);
	});

	it('keeps a one-day hole as a hole', () => {
		expect(
			mergePeriodes([
				{ debut: day('2026-01-01'), fin: day('2026-02-01') },
				{ debut: day('2026-02-02'), fin: day('2026-03-01') }
			])
		).toHaveLength(2);
	});

	it('never shortens a range because of a period inside it', () => {
		expect(
			mergePeriodes([
				{ debut: day('2026-01-01'), fin: day('2026-12-01') },
				{ debut: day('2026-03-01'), fin: day('2026-04-01') }
			])
		).toEqual([{ debut: day('2026-01-01'), fin: day('2026-12-01') }]);
	});

	it('does not modify what it is given', () => {
		const input = [
			{ debut: day('2026-01-01'), fin: day('2026-02-01') },
			{ debut: day('2026-01-15'), fin: day('2026-03-01') }
		];
		mergePeriodes(input);
		expect(input[0].fin).toEqual(day('2026-02-01'));
	});
});

describe('missingMonthsInGap', () => {
	it('counts a month as missing when its 15th is uncovered', () => {
		expect(missingMonthsInGap(day('2026-02-01'), day('2026-05-01'))).toEqual([
			{ start: day('2026-02-01'), end: day('2026-02-28') },
			{ start: day('2026-03-01'), end: day('2026-03-31') },
			{ start: day('2026-04-01'), end: day('2026-04-30') }
		]);
	});

	// The LgHS convention: "end of M-1 → end of M" pays for M. A boundary on the last day of a
	// month must not flag the month it closes.
	it('does not flag the month a cotisation ending on its last day closes', () => {
		expect(missingMonthsInGap(day('2026-01-31'), day('2026-02-28'))).toEqual([{ start: day('2026-02-01'), end: day('2026-02-28') }]);
		expect(missingMonthsInGap(day('2026-01-31'), day('2026-02-10'))).toEqual([]);
	});
});

describe('detectCotisationGaps', () => {
	it('lists interior gaps in full and only the last three months of an ongoing lapse', () => {
		const coverage = [
			{ debut: day('2025-01-01'), fin: day('2025-03-01') },
			{ debut: day('2025-06-01'), fin: day('2025-07-01') }
		];
		const gaps = detectCotisationGaps(coverage, day('2026-01-20'));
		expect(gaps.map((g) => g.start.toISOString().slice(0, 7))).toEqual(['2025-03', '2025-04', '2025-05', '2025-11', '2025-12', '2026-01']);
	});

	it('reports nothing while coverage still runs', () => {
		expect(detectCotisationGaps([{ debut: day('2026-01-01'), fin: day('2027-01-01') }], day('2026-06-15'))).toEqual([]);
	});
});

describe('computeSituation', () => {
	it('is à jour while today is covered, with the last covered day', () => {
		const s = computeSituation(member, [cotisation('2026-01-01', '2026-12-31')], GRACE, day('2026-06-15'));
		expect(s).toMatchObject({ status: 'a_jour', datefin: day('2026-12-31'), isInactive: false, finGrace: null, via: null });
	});

	it('is à jour on the last covered day and en grâce the day after', () => {
		const history = [cotisation('2026-01-01', '2026-03-31')];
		expect(computeSituation(member, history, GRACE, day('2026-03-31')).status).toBe('a_jour');
		const next = computeSituation(member, history, GRACE, day('2026-04-01'));
		expect(next).toMatchObject({ status: 'en_grace', datefin: day('2026-03-31'), isInactive: false });
	});

	it('keeps access exactly delaiGraceJours days, then expires and deactivates', () => {
		const history = [cotisation('2026-01-01', '2026-03-31')];
		// 90 days from April 1st inclusive: the last day of grace is June 29th.
		expect(computeSituation(member, history, GRACE, day('2026-06-29'))).toMatchObject({ status: 'en_grace', finGrace: day('2026-06-29') });
		expect(computeSituation(member, history, GRACE, day('2026-06-30'))).toMatchObject({ status: 'expiree', isInactive: true, finGrace: null });
	});

	it('with no grace at all, expires the day coverage ends', () => {
		expect(computeSituation(member, [cotisation('2026-01-01', '2026-03-31')], 0, day('2026-04-01')).status).toBe('expiree');
	});

	// An invoiced-but-unpaid cotisation must not open the door: only a paid (active) one covers.
	it('does not count an unpaid or cancelled cotisation as coverage', () => {
		const history = [
			cotisation('2026-01-01', '2026-12-31', { statut: 'attendue' }),
			cotisation('2026-01-01', '2026-12-31', { id: 2, statut: 'annulee' })
		];
		expect(computeSituation(member, history, GRACE, day('2026-06-15'))).toMatchObject({ status: 'en_attente', datefin: null });
	});

	it('is en attente for a member who never paid, and for one only paid in advance', () => {
		expect(computeSituation(member, [], GRACE, day('2026-06-15')).status).toBe('en_attente');
		expect(computeSituation(member, [cotisation('2026-09-01', '2027-08-31')], GRACE, day('2026-06-15')).status).toBe('en_attente');
	});

	it('is non applicable for an exempt member, whatever the history', () => {
		expect(computeSituation({ exempteCotisation: true }, [], GRACE, day('2026-06-15')).status).toBe('non_applicable');
	});

	it('bridges back-to-back cotisations into one coverage', () => {
		const history = [cotisation('2026-01-01', '2026-01-31'), cotisation('2026-02-01', '2026-02-28', { id: 2 })];
		expect(computeSituation(member, history, GRACE, day('2026-02-20'))).toMatchObject({ status: 'a_jour', datefin: day('2026-02-28') });
	});

	it('says who pays for today, preferring the member’s own over a company’s, and lists both', () => {
		const history = [
			cotisation('2026-01-01', '2026-12-31', { id: 2, via: 'Exemple SRL' }),
			cotisation('2026-06-01', '2026-06-30')
		];
		const s = computeSituation(member, history, GRACE, day('2026-06-15'));
		expect(s.via).toBeNull();
		expect(s.sourcesAujourdhui).toEqual([null, 'Exemple SRL']);
		expect(computeSituation(member, history, GRACE, day('2026-08-15'))).toMatchObject({ via: 'Exemple SRL', sourcesAujourdhui: ['Exemple SRL'] });
	});
});
