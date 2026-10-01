import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	validateBirthday,
	validateDiscordUsername,
	validateEmergencyContactsSubmission,
	validateMastodonHandle,
	validateMatrixId,
	validateProfileSubmission,
	validateSignalUsername,
	validateTelegramUsername,
	validateTrombiEmail,
	validateUsername
} from '$lib/server/profileValidation';

type Result = { ok: true; value: string } | { ok: false; error: string };
const value = (r: Result) => (r.ok ? r.value : `ERREUR: ${r.error}`);

describe("nom d'utilisateur", () => {
	it('accepte lettres non accentuées, chiffres, . - _', () => {
		expect(value(validateUsername('  ana_b.c-9 '))).toBe('ana_b.c-9');
	});
	it('refuse vide, trop long, accents et espaces', () => {
		for (const raw of ['', '   ', 'a'.repeat(33), 'éloïse', 'ana b', 'ana@b']) {
			expect(validateUsername(raw).ok).toBe(false);
		}
	});
});

describe('email du trombinoscope', () => {
	it('est facultatif', () => expect(value(validateTrombiEmail('  '))).toBe(''));
	it('accepte une adresse valide', () => expect(value(validateTrombiEmail(' ana@lghs.be '))).toBe('ana@lghs.be'));
	it('refuse une adresse invalide', () => {
		for (const raw of ['ana', 'ana@', 'ana@lghs', 'a b@lghs.be']) expect(validateTrombiEmail(raw).ok).toBe(false);
	});
});

describe('Signal', () => {
	it('est facultatif', () => expect(value(validateSignalUsername(''))).toBe(''));
	it('accepte pseudo.chiffres, en minuscules', () => {
		expect(value(validateSignalUsername('Ana.27'))).toBe('ana.27');
		expect(value(validateSignalUsername('ana.05'))).toBe('ana.05');
	});
	it('refuse les formats invalides', () => {
		for (const raw of ['ana27', 'an.27', '1ana.27', 'ana-b.27', 'ana.', 'ana.2', 'ana.2a', 'ana.012', 'ana.27.1']) {
			expect(validateSignalUsername(raw).ok, raw).toBe(false);
		}
	});
});

describe('Telegram', () => {
	it('accepte un pseudo, avec ou sans @', () => {
		expect(value(validateTelegramUsername('@Ana_Bc'))).toBe('ana_bc');
	});
	it('refuse les formats invalides', () => {
		for (const raw of ['ana', '1anabc', 'ana-bc', 'anabc_', 'ana__bc', 'a'.repeat(33)]) {
			expect(validateTelegramUsername(raw).ok, raw).toBe(false);
		}
	});
});

describe('Discord', () => {
	it('accepte un pseudo, avec ou sans @', () => {
		expect(value(validateDiscordUsername('@Ana.b_9'))).toBe('ana.b_9');
	});
	it('refuse les formats invalides', () => {
		for (const raw of ['a', '.ana', 'ana.', 'an..a', 'ana-b', 'a'.repeat(33)]) {
			expect(validateDiscordUsername(raw).ok, raw).toBe(false);
		}
	});
});

describe('Matrix', () => {
	it('accepte @pseudo:serveur, avec un port éventuel', () => {
		expect(value(validateMatrixId('@Ana:Matrix.org'))).toBe('@ana:matrix.org');
		expect(value(validateMatrixId('@ana:matrix.lghs.be:8448'))).toBe('@ana:matrix.lghs.be:8448');
	});
	it('refuse les formats invalides', () => {
		for (const raw of ['ana:matrix.org', '@ana', '@:matrix.org', '@ana:', '@ana:localhost', '@an a:matrix.org']) {
			expect(validateMatrixId(raw).ok, raw).toBe(false);
		}
	});
});

describe('Mastodon', () => {
	it('accepte @pseudo@instance et pseudo@instance', () => {
		expect(value(validateMastodonHandle('@iooner@Mastodon.Social'))).toBe('@iooner@mastodon.social');
		expect(value(validateMastodonHandle('iooner@mastodon.social'))).toBe('@iooner@mastodon.social');
	});
	it('accepte l’URL du profil', () => {
		expect(value(validateMastodonHandle('https://mastodon.social/@iooner'))).toBe('@iooner@mastodon.social');
	});
	it('refuse les formats invalides', () => {
		for (const raw of ['@iooner', 'iooner@', '@@mastodon.social', '@io-oner@mastodon.social', '@iooner@localhost']) {
			expect(validateMastodonHandle(raw).ok, raw).toBe(false);
		}
	});
});

describe('date de naissance', () => {
	afterEach(() => vi.useRealTimers());
	const on = (iso: string) => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(`${iso}T12:00:00`));
	};

	it('est facultative', () => expect(value(validateBirthday(''))).toBe(''));

	it('accepte une date complète, ou seulement jour et mois', () => {
		expect(value(validateBirthday('1990-05-17'))).toBe('1990-05-17');
		expect(value(validateBirthday('05-17'))).toBe('05-17');
	});

	it('gère le 29 février : année bissextile oui, non bissextile non, sans année oui', () => {
		expect(validateBirthday('2000-02-29').ok).toBe(true);
		expect(validateBirthday('1900-02-29').ok).toBe(false);
		expect(validateBirthday('1999-02-29').ok).toBe(false);
		expect(validateBirthday('02-29').ok).toBe(true);
	});

	it('refuse les mois, jours et années impossibles', () => {
		for (const raw of ['1990-13-01', '1990-00-10', '1990-04-31', '1899-05-17', '17/05/1990', '1990-5-17']) {
			expect(validateBirthday(raw).ok, raw).toBe(false);
		}
	});

	it('refuse une date plus tard dans l’année en cours, accepte aujourd’hui', () => {
		on('2026-09-22');
		expect(validateBirthday('2026-12-31').ok).toBe(false);
		expect(validateBirthday('2027-01-01').ok).toBe(false);
		expect(validateBirthday('2026-09-22').ok).toBe(true);
	});
});

describe('formulaire de profil : téléphone', () => {
	const form = (phoneNumber: string) => {
		const data = new FormData();
		const fields = {
			firstName: 'Ana', lastName: 'B', phoneNumber, street: 'Rue 1', postal_code: '4000',
			locality: 'Liège', country: 'Belgique'
		};
		for (const [k, v] of Object.entries(fields)) data.append(k, v);
		return data;
	};

	it('accepte le format 32470000000 et retire espaces, tirets et parenthèses', () => {
		const result = validateProfileSubmission(form('32 (470) 00-00.00'));
		expect(result.ok).toBe(true);
		expect(result.attributes.phoneNumber).toBe('32470000000');
	});

	it('refuse un « + », un 0 initial ou un numéro trop court', () => {
		for (const raw of ['+32470000000', '0470000000', '3247000']) {
			expect(validateProfileSubmission(form(raw)).ok, raw).toBe(false);
		}
	});

	it('exige les champs obligatoires', () => {
		const data = form('32470000000');
		data.set('locality', '');
		expect(validateProfileSubmission(data).ok).toBe(false);
	});
});

describe("contacts d'urgence", () => {
	const contacts = (...rows: [string, string, string?][]) => {
		const data = new FormData();
		for (const [name, phone, relation = ''] of rows) {
			data.append('name[]', name);
			data.append('phone[]', phone);
			data.append('relation[]', relation);
		}
		return data;
	};

	it('ignore les lignes entièrement vides et nettoie le numéro', () => {
		const result = validateEmergencyContactsSubmission(contacts(['Jeanne', '32 470 00 00 00', 'Mère'], ['', '', '']));
		expect(result.ok).toBe(true);
		expect(result.contacts).toEqual([{ name: 'Jeanne', phone: '32470000000', relation: 'Mère' }]);
	});

	it('refuse une ligne à moitié remplie', () => {
		expect(validateEmergencyContactsSubmission(contacts(['Jeanne', ''])).ok).toBe(false);
		expect(validateEmergencyContactsSubmission(contacts(['', '32470000000'])).ok).toBe(false);
	});

	it('refuse un numéro au mauvais format', () => {
		expect(validateEmergencyContactsSubmission(contacts(['Jeanne', '0470000000'])).ok).toBe(false);
	});

	it('refuse plus de 3 contacts', () => {
		const four = Array.from({ length: 4 }, (_, i) => [`P${i}`, '32470000000'] as [string, string]);
		expect(validateEmergencyContactsSubmission(contacts(...four)).ok).toBe(false);
	});
});
