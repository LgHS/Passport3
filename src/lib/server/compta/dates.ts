// Calendar-date helpers shared by the compta modules.
//
// Every accounting date (cotisation bounds, invoice dates, bank value dates) is a *calendar day*,
// not an instant. The convention, inherited from the old gap detection, is to pin such a day to
// midnight UTC and to read it back in UTC everywhere (`getUTC*`, `timeZone: 'UTC'` when formatting)
// — read in local time, a day slips to the previous evening for anyone west of Greenwich.
//
// Postgres DATE columns are selected as `::text` ('YYYY-MM-DD') and parsed here, rather than relying
// on postgres.js's own DATE parser, so the pinning is explicit in one place.

export function parseIsoDate(iso: string): Date {
	// `new Date('YYYY-MM-DD')` is specified to parse as UTC midnight, exactly the convention above.
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid ISO date: ${iso}`);
	}
	return date;
}

export function toIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

// Accepts 'YYYY-MM-DD' from a form field; null for anything else, so callers can `fail(400)` with
// a proper message instead of letting an invalid date reach Postgres.
export function parseFormDate(value: FormDataEntryValue | null): Date | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = new Date(value);
	// Rejects e.g. 2026-02-30, which `new Date` would silently roll into March.
	return Number.isNaN(date.getTime()) || toIsoDate(date) !== value ? null : date;
}

const brusselsDay = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Brussels',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

// "Today" as the treasury and the members mean it — the calendar day in Brussels, pinned to UTC
// midnight like every other date here. Using the raw UTC day would be a day off between midnight
// and 1/2am local time, which is exactly when a cotisation boundary matters most.
export function brusselsToday(now: Date = new Date()): Date {
	return parseIsoDate(brusselsDay.format(now)); // en-CA formats as YYYY-MM-DD
}

export function addUTCDays(date: Date, days: number): Date {
	const shifted = new Date(date.getTime());
	shifted.setUTCDate(shifted.getUTCDate() + days);
	return shifted;
}

// `setUTCMonth` normalises day overflow: 31/01 + 1 month gives 03/03 (or 02/03), not a
// non-existent 31/02. Periods here start on the 1st, where this never comes up.
export function addUTCMonths(date: Date, months: number): Date {
	const shifted = new Date(date.getTime());
	shifted.setUTCMonth(shifted.getUTCMonth() + months);
	return shifted;
}

export function compareDates(a: Date, b: Date): number {
	return a.getTime() - b.getTime();
}

// NUMERIC comes back from postgres.js as a string (it refuses to lose precision into a float); at
// the application boundary a Number is fine for display and form round-trips — sums that matter
// are done in SQL.
export function parseMoney(value: string | number | null | undefined): number {
	if (value === null || value === undefined) return 0;
	const n = typeof value === 'number' ? value : Number.parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

// Form-field money: accepts "12", "12.5", "12,50" (Belgian keyboards type a comma). Null when it
// isn't a non-negative amount with at most two decimals.
export function parseFormMoney(value: FormDataEntryValue | null): number | null {
	if (typeof value !== 'string') return null;
	const normalised = value.trim().replace(',', '.');
	if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;
	return Number.parseFloat(normalised);
}
