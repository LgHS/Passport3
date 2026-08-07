import { PROFILE_ATTRIBUTE_FIELDS } from '$lib/server/authentikAdmin';

const REQUIRED_MESSAGES: Record<string, string> = {
	firstName: 'Le prénom ne peut pas être vide.',
	lastName: 'Le nom ne peut pas être vide.',
	phoneNumber: 'Le téléphone ne peut pas être vide.',
	street: 'La rue ne peut pas être vide.',
	postal_code: 'Le code postal ne peut pas être vide.',
	locality: 'La localité ne peut pas être vide.',
	country: 'Le pays ne peut pas être vide.'
};

// Format Signal : pseudo.discriminateur (ex. "ana.27").
// - pseudo : 3-32 caractères, [a-z0-9_], ne commence pas par un chiffre
// - discriminateur : 2-9 chiffres, pas de zéro en tête sauf 01-09
// Décomposé en étapes (plutôt qu'un seul regex + erreur générique) pour pouvoir pointer
// précisément ce qui cloche — le champ est optionnel, donc une valeur vide est toujours valide.
function validateSignalUsername(raw: string): { ok: true; value: string } | { ok: false; error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: true, value: '' };

	const value = trimmed.toLowerCase();
	const dotIndex = value.indexOf('.');
	if (dotIndex === -1) {
		return {
			ok: false,
			error: 'Signal : il manque le point séparateur (format attendu : pseudo.chiffres, ex. ana.27).'
		};
	}

	const pseudo = value.slice(0, dotIndex);
	const digits = value.slice(dotIndex + 1);

	if (digits.includes('.')) {
		return { ok: false, error: 'Signal : un seul point séparateur est autorisé.' };
	}
	if (pseudo.length < 3) {
		return { ok: false, error: 'Signal : le pseudo doit faire au moins 3 caractères.' };
	}
	if (pseudo.length > 32) {
		return { ok: false, error: 'Signal : le pseudo ne peut pas dépasser 32 caractères.' };
	}
	if (/^[0-9]/.test(pseudo)) {
		return { ok: false, error: 'Signal : le pseudo ne peut pas commencer par un chiffre.' };
	}
	if (!/^[a-z0-9_]+$/.test(pseudo)) {
		return {
			ok: false,
			error:
				'Signal : le pseudo ne peut contenir que des lettres, chiffres et underscores (pas de tiret, espace, accent ou emoji).'
		};
	}
	if (digits.length === 0) {
		return { ok: false, error: 'Signal : il manque les chiffres après le point.' };
	}
	if (!/^[0-9]+$/.test(digits)) {
		return { ok: false, error: 'Signal : la partie après le point ne peut contenir que des chiffres.' };
	}
	if (digits.length < 2 || digits.length > 9) {
		return { ok: false, error: 'Signal : le nombre de chiffres après le point doit être entre 2 et 9.' };
	}
	if (digits[0] === '0' && !/^0[1-9]$/.test(digits)) {
		return { ok: false, error: 'Signal : zéro en tête invalide (autorisé uniquement pour 01 à 09).' };
	}

	return { ok: true, value };
}

// Règles officielles Telegram : pseudo (avec ou sans "@" collé devant), 5-32 caractères,
// commence par une lettre, uniquement lettres/chiffres/underscore, jamais un underscore final,
// jamais deux underscores consécutifs.
function validateTelegramUsername(raw: string): { ok: true; value: string } | { ok: false; error: string } {
	const trimmed = raw.trim().replace(/^@/, '');
	if (!trimmed) return { ok: true, value: '' };

	const value = trimmed.toLowerCase();
	if (value.length < 5) {
		return { ok: false, error: 'Telegram : le pseudo doit faire au moins 5 caractères.' };
	}
	if (value.length > 32) {
		return { ok: false, error: 'Telegram : le pseudo ne peut pas dépasser 32 caractères.' };
	}
	if (!/^[a-z]/.test(value)) {
		return { ok: false, error: 'Telegram : le pseudo doit commencer par une lettre.' };
	}
	if (!/^[a-z0-9_]+$/.test(value)) {
		return {
			ok: false,
			error: 'Telegram : le pseudo ne peut contenir que des lettres, chiffres et underscores.'
		};
	}
	if (value.endsWith('_')) {
		return { ok: false, error: 'Telegram : le pseudo ne peut pas se terminer par un underscore.' };
	}
	if (value.includes('__')) {
		return { ok: false, error: 'Telegram : deux underscores consécutifs ne sont pas autorisés.' };
	}

	return { ok: true, value };
}

// Règles officielles Discord (nouveau système de pseudo, sans discriminateur "#0000" — abandonné
// depuis 2023 pour la quasi-totalité des comptes) : 2-32 caractères, minuscules, chiffres,
// underscore et point, jamais de point en tête/fin, jamais deux points consécutifs.
function validateDiscordUsername(raw: string): { ok: true; value: string } | { ok: false; error: string } {
	const trimmed = raw.trim().replace(/^@/, '');
	if (!trimmed) return { ok: true, value: '' };

	const value = trimmed.toLowerCase();
	if (value.length < 2) {
		return { ok: false, error: 'Discord : le pseudo doit faire au moins 2 caractères.' };
	}
	if (value.length > 32) {
		return { ok: false, error: 'Discord : le pseudo ne peut pas dépasser 32 caractères.' };
	}
	if (!/^[a-z0-9_.]+$/.test(value)) {
		return {
			ok: false,
			error:
				'Discord : le pseudo ne peut contenir que des lettres minuscules, chiffres, underscores et points.'
		};
	}
	if (value.startsWith('.') || value.endsWith('.')) {
		return { ok: false, error: 'Discord : le pseudo ne peut pas commencer ou finir par un point.' };
	}
	if (value.includes('..')) {
		return { ok: false, error: 'Discord : deux points consécutifs ne sont pas autorisés.' };
	}

	return { ok: true, value };
}

export type ProfileValidationResult =
	| {
			ok: true;
			name: string;
			firstName: string;
			lastName: string;
			attributes: Record<string, string>;
	  }
	| {
			ok: false;
			error: string;
			firstName: string;
			lastName: string;
			attributes: Record<string, string>;
	  };

export function validateProfileSubmission(formData: FormData): ProfileValidationResult {
	const firstName = String(formData.get('firstName') ?? '').trim();
	const lastName = String(formData.get('lastName') ?? '').trim();
	const attributes: Record<string, string> = {};
	for (const { key } of PROFILE_ATTRIBUTE_FIELDS) {
		attributes[key] = String(formData.get(key) ?? '').trim();
	}
	// Normalize away spaces/dashes/parens users naturally type ("32 470 00 00 00") so the
	// stored value matches the plain-digits format the field asks for.
	attributes.phoneNumber = attributes.phoneNumber.replace(/[\s().-]/g, '');

	if (!firstName) {
		return { ok: false, error: REQUIRED_MESSAGES.firstName, firstName, lastName, attributes };
	}
	if (!lastName) {
		return { ok: false, error: REQUIRED_MESSAGES.lastName, firstName, lastName, attributes };
	}
	for (const field of PROFILE_ATTRIBUTE_FIELDS) {
		if (field.required && !attributes[field.key]) {
			return { ok: false, error: REQUIRED_MESSAGES[field.key], firstName, lastName, attributes };
		}
	}
	// Country code + local number, digits only, no leading '+' or '0' (e.g. 32470000000).
	if (!/^[1-9]\d{7,14}$/.test(attributes.phoneNumber)) {
		return {
			ok: false,
			error: 'Numéro de téléphone invalide (format attendu: 32470000000, sans "+" ni "0" initial).',
			firstName,
			lastName,
			attributes
		};
	}

	const signalResult = validateSignalUsername(attributes.signal ?? '');
	if (!signalResult.ok) {
		return { ok: false, error: signalResult.error, firstName, lastName, attributes };
	}
	attributes.signal = signalResult.value;

	const telegramResult = validateTelegramUsername(attributes.telegram ?? '');
	if (!telegramResult.ok) {
		return { ok: false, error: telegramResult.error, firstName, lastName, attributes };
	}
	attributes.telegram = telegramResult.value;

	const discordResult = validateDiscordUsername(attributes.discord ?? '');
	if (!discordResult.ok) {
		return { ok: false, error: discordResult.error, firstName, lastName, attributes };
	}
	attributes.discord = discordResult.value;

	// Authentik only has a single `name` field — merge on write, split back on display.
	const name = `${firstName} ${lastName}`.trim();
	return { ok: true, name, firstName, lastName, attributes };
}
