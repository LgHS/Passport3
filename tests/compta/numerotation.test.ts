import { describe, expect, it } from 'vitest';
import { communicationStructuree } from '$lib/server/compta/factures';
import { migrations } from '$lib/server/migrations';

// The bank's own check: the first ten digits mod 97, with 0 written as 97.
function checkDigitsValid(communication: string): boolean {
	const digits = communication.replace(/\D/g, '');
	const mod = Number(BigInt(digits.slice(0, 10)) % 97n);
	return digits.length === 12 && Number(digits.slice(10)) === (mod === 0 ? 97 : mod);
}

describe('communicationStructuree', () => {
	it('is printed +++NNN/NNNN/NNNNN+++ with the year and the number as payload', () => {
		const c = communicationStructuree('2026-0007');
		expect(c).toMatch(/^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
		expect(c.replace(/\D/g, '').slice(0, 10)).toBe('2026000007');
	});

	it('carries check digits a Belgian bank accepts, for every number of a year', () => {
		for (let n = 1; n <= 9999; n++) {
			const c = communicationStructuree(`2026-${String(n).padStart(4, '0')}`);
			if (!checkDigitsValid(c)) throw new Error(`${c} refusée par la banque`);
		}
	});

	it('writes a remainder of 0 as 97', () => {
		const n = [...Array(200).keys()].find((i) => (2026000000n + BigInt(i)) % 97n === 0n)!;
		expect(communicationStructuree(`2026-${String(n).padStart(4, '0')}`).replace(/\D/g, '').slice(10)).toBe('97');
	});

	it('gives two invoices two different communications', () => {
		const all = new Set([...Array(500).keys()].map((n) => communicationStructuree(`2026-${String(n + 1).padStart(4, '0')}`)));
		expect(all.size).toBe(500);
	});
});

describe('migrations', () => {
	// Two branches each taking "the next number" is how compta's 20–27 once collided with main's:
	// the second migration of a pair is seen as applied and silently skipped.
	it('never reuse a version number', () => {
		const versions = migrations.map((m) => m.version);
		expect(new Set(versions).size).toBe(versions.length);
	});

	it('never reuse a name', () => {
		const names = migrations.map((m) => m.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
