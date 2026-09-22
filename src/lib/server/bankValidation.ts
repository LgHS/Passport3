export function normalizeIban(raw: string): string {
	return raw.replace(/\s+/g, '').toUpperCase();
}

// For anywhere an IBAN is persisted outside of Dolibarr itself (the audit log, notably) — keeping
// enough to spot which account changed without keeping the full number at rest in a second place.
// '' -> null (nothing to mask, matches "no IBAN" the same way the rest of this module treats it).
export function maskIban(raw: string): string | null {
	const iban = normalizeIban(raw);
	if (!iban) return null;
	return iban.length <= 4 ? iban : `••••${iban.slice(-4)}`;
}

// Format (ISO 13616) + mod-97 checksum (ISO 7064) — a plausible-looking string isn't enough
// before this gets written into Dolibarr's accounting data, so validate the real checksum
// server-side rather than trusting the client-side input pattern.
export function isValidIban(raw: string): boolean {
	const iban = normalizeIban(raw);
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;

	const rearranged = iban.slice(4) + iban.slice(0, 4);
	const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));

	let remainder = 0;
	for (const digit of numeric) {
		remainder = (remainder * 10 + Number(digit)) % 97;
	}
	return remainder === 1;
}

export type BankInfoValidationResult =
	| { ok: true; ibanPerso: string; ibanPro: string }
	| { ok: false; error: string; ibanPerso: string; ibanPro: string };

export function validateBankInfoSubmission(formData: FormData): BankInfoValidationResult {
	const ibanPerso = normalizeIban(String(formData.get('ibanPerso') ?? ''));
	const ibanPro = normalizeIban(String(formData.get('ibanPro') ?? ''));

	// Empty is a valid submission — it means "clear this IBAN" — but anything non-empty has to be
	// a real, checksum-valid IBAN before it gets written into Dolibarr's accounting data.
	if (ibanPerso && !isValidIban(ibanPerso)) {
		return {
			ok: false,
			error: 'IBAN personnel invalide (vérifiez le numéro).',
			ibanPerso,
			ibanPro
		};
	}
	if (ibanPro && !isValidIban(ibanPro)) {
		return {
			ok: false,
			error: 'IBAN professionnel invalide (vérifiez le numéro).',
			ibanPerso,
			ibanPro
		};
	}

	return { ok: true, ibanPerso, ibanPro };
}
