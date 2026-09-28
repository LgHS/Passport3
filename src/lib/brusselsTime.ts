// Wall-clock times of the hackerspace, which is in Liège. A `datetime-local` field submits
// "2026-09-28T16:39" with no timezone, and `new Date()` would read that in the *server's* timezone
// (UTC in the Docker image), shifting it by one or two hours — enough to reject a declaration
// pre-filled with "now" as being in the future. Everything here pins it to Europe/Brussels instead,
// whatever the server's or the member's machine timezone. Client-safe (plain Intl).
const TIME_ZONE = 'Europe/Brussels';

const partsFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: TIME_ZONE,
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

function brusselsParts(date: Date): Record<string, number> {
	return Object.fromEntries(
		partsFormat
			.formatToParts(date)
			.filter((p) => p.type !== 'literal')
			.map((p) => [p.type, Number(p.value)])
	);
}

// How far Brussels is ahead of UTC at this instant, in ms (1 or 2 hours depending on DST).
function brusselsOffset(epochMs: number): number {
	const p = brusselsParts(new Date(epochMs));
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(epochMs / 1000) * 1000;
}

// "YYYY-MM-DDTHH:mm" as Brussels wall-clock time → the actual instant, or null if malformed.
export function parseBrusselsDateTime(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	if (!m) return null;
	const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
	// Twice: the offset is looked up at a first guess, then at the corrected instant, which settles
	// it on the right side of a DST change.
	let epoch = asUtc - brusselsOffset(asUtc);
	epoch = asUtc - brusselsOffset(epoch);
	const date = new Date(epoch);
	return Number.isNaN(date.getTime()) ? null : date;
}

// The current Brussels wall-clock time, in the format a `datetime-local` field expects.
export function brusselsNowInput(now = new Date()): string {
	const p = brusselsParts(now);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
