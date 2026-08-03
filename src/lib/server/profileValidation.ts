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
	for (const { key } of PROFILE_ATTRIBUTE_FIELDS) {
		if (!attributes[key]) {
			return { ok: false, error: REQUIRED_MESSAGES[key], firstName, lastName, attributes };
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

	// Authentik only has a single `name` field — merge on write, split back on display.
	const name = `${firstName} ${lastName}`.trim();
	return { ok: true, name, firstName, lastName, attributes };
}
