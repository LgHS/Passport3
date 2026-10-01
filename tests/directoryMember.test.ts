import { afterEach, describe, expect, it, vi } from 'vitest';

// The chat link needs the Mattermost address and team, and listDirectoryMembers() an Authentik
// address and token — Authentik itself is replaced by a stubbed fetch below.
vi.mock('$env/dynamic/private', () => ({ env: {
		MATTERMOST_URL: 'https://chat.exemple.be',
		MATTERMOST_TEAM_SLUG: 'lghs',
		AUTHENTIK_ISSUER: 'https://auth.exemple.be/application/o/passport/',
		AUTHENTIK_API_TOKEN: 'test'
	} }));
import {
	listDirectoryMembers,
	pickTrombinoscopeOptin,
	toDirectoryMember,
	type TrombinoscopeOptin
} from '$lib/server/authentikAdmin';

// An Authentik record carrying everything a member can have, private fields included.
const record = (trombinoscope: Record<string, unknown> = {}) => ({
	pk: 12,
	username: 'ana',
	name: 'Ana Dupont Durand',
	email: 'ana@exemple.be',
	avatar: '',
	attributes: {
		trombinoscope,
		phoneNumber: '32470000000',
		birthday: '1990-05-17',
		street: 'Rue du Pont 1',
		postal_code: '4000',
		rfid_uid: '6f1c2a4e-9b7d-4c3a-8e21-0d5f7a9b1c34',
		emergencyContacts: [{ name: 'Jeanne', phone: '32471111111' }],
		signal: 'ana.27',
		mastodon: '@ana@mastodon.social'
	}
});

const optin = (over: Partial<TrombinoscopeOptin> = {}): TrombinoscopeOptin => ({
	visible: true,
	showChat: false,
	showFirstname: false,
	showLastname: false,
	showMail: false,
	showPhone: false,
	trombiEmail: '',
	...over
});

describe('fiche du trombinoscope : ce qui est montré', () => {
	it('par défaut, seulement le nom d’utilisateur et ce qui est public de toute façon', () => {
		const member = toDirectoryMember(record(), optin(), null);
		expect(member.username).toBe('ana');
		expect(member.firstName).toBeNull();
		expect(member.lastName).toBeNull();
		expect(member.email).toBeNull();
		expect(member.phone).toBeNull();
		expect(member.mattermostUsername).toBeNull();
	});

	it('montre chaque champ seulement si sa case est cochée', () => {
		const member = toDirectoryMember(
			record(),
			optin({ showFirstname: true, showLastname: true, showMail: true, showPhone: true }),
			null
		);
		expect(member.firstName).toBe('Ana');
		expect(member.lastName).toBe('Dupont Durand');
		expect(member.email).toBe('ana@exemple.be');
		expect(member.phone).toBe('32470000000');
	});

	it('montre l’email de remplacement plutôt que celui du compte', () => {
		const member = toDirectoryMember(record(), optin({ showMail: true, trombiEmail: 'contact@ana.be' }), null);
		expect(member.email).toBe('contact@ana.be');
	});

	it('ne montre pas l’email de remplacement si l’email est décoché', () => {
		expect(toDirectoryMember(record(), optin({ trombiEmail: 'contact@ana.be' }), null).email).toBeNull();
	});

	it('montre les pseudos remplis sans case à cocher : les remplir vaut accord', () => {
		const member = toDirectoryMember(record(), optin(), null);
		expect(member.signal).toBe('ana.27');
		expect(member.mastodon).toBe('@ana@mastodon.social');
	});

	it('ne montre jamais date de naissance, adresse, UUID RFID ni contacts d’urgence', () => {
		const member = toDirectoryMember(
			record(),
			optin({ showFirstname: true, showLastname: true, showMail: true, showPhone: true, showChat: true }),
			'ana'
		);
		const shown = JSON.stringify(member);
		for (const secret of ['1990-05-17', 'Rue du Pont', '4000', '6f1c2a4e', 'Jeanne', '32471111111']) {
			expect(shown, secret).not.toContain(secret);
		}
		expect(Object.keys(member)).not.toEqual(expect.arrayContaining(['birthday', 'rfid_uid', 'emergencyContacts']));
	});
});

describe('lecture des cases du trombinoscope', () => {
	it('est cachée et tout est décoché par défaut, sauf le chat', () => {
		const o = pickTrombinoscopeOptin(undefined);
		expect(o.visible).toBe(false);
		expect([o.showFirstname, o.showLastname, o.showMail, o.showPhone]).toEqual([false, false, false, false]);
		expect(o.showChat).toBe(true);
	});

	it('reprend les cases enregistrées', () => {
		const o = pickTrombinoscopeOptin({ visible: true, showPhone: true, trombiEmail: 'x@y.be' });
		expect(o.visible).toBe(true);
		expect(o.showPhone).toBe(true);
		expect(o.trombiEmail).toBe('x@y.be');
	});

	it('ignore une valeur qui n’est pas vraiment vrai ou faux, plutôt que de la lire comme cochée', () => {
		const o = pickTrombinoscopeOptin({ visible: 'true', showPhone: 'non', showMail: 1 });
		expect(o.visible).toBe(false);
		expect(o.showPhone).toBe(false);
		expect(o.showMail).toBe(false);
	});
});

describe('liste du trombinoscope', () => {
	// Authentik's user list as the API returns it: whoever is in it, active or not.
	function stubAuthentik(users: Record<string, unknown>[]) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ results: users }), { status: 200 }))
		);
	}
	const user = (username: string, trombinoscope: unknown, over: Record<string, unknown> = {}) => ({
		...record(),
		username,
		is_active: true,
		type: 'internal',
		attributes: { ...record().attributes, trombinoscope },
		...over
	});

	afterEach(() => vi.unstubAllGlobals());

	it('ne liste que les membres actifs qui ont choisi d’être visibles', async () => {
		stubAuthentik([
			user('visible', { visible: true, showChat: false }),
			user('cache', { visible: false }),
			user('jamaischoisi', undefined),
			user('inactif', { visible: true, showChat: false }, { is_active: false }),
			user('robot', { visible: true, showChat: false }, { type: 'service_account' })
		]);
		expect((await listDirectoryMembers()).map((m) => m.username)).toEqual(['visible']);
	});

	it('n’affiche pas un membre ni son téléphone sur une valeur qui n’est pas vraiment « vrai »', async () => {
		stubAuthentik([
			user('texte', { visible: 'true', showChat: false }),
			user('telephone', { visible: true, showChat: false, showPhone: 'non' })
		]);
		const members = await listDirectoryMembers();
		expect(members.map((m) => m.username)).toEqual(['telephone']);
		expect(members[0].phone).toBeNull();
	});
});
