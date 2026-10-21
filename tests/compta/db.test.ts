import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Against a real Postgres: numbering, allocations and the invoice → cotisation cycle are rules held
// by SQL (locks, upserts, transactions), which a mocked database would only pretend to check.
//
// Runs only when a dedicated test database is configured, and only one whose name ends in `_test`:
// the schema is dropped and rebuilt from the migrations at the start. Locally:
//   docker run -d --name passport-test-pg -e POSTGRES_USER=passport -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=passport_test -p 55432:5432 postgres:17-alpine
//   TEST_POSTGRES_PORT=55432 TEST_POSTGRES_DB=passport_test TEST_POSTGRES_USER=passport \
//     TEST_POSTGRES_PASSWORD=test pnpm test
const target = {
	host: process.env.TEST_POSTGRES_HOST || 'localhost',
	port: Number(process.env.TEST_POSTGRES_PORT) || 5432,
	database: process.env.TEST_POSTGRES_DB ?? '',
	user: process.env.TEST_POSTGRES_USER,
	password: process.env.TEST_POSTGRES_PASSWORD
};
const enabled = target.database.endsWith('_test');

vi.mock('$env/dynamic/private', () => ({
	env: {
		POSTGRES_HOST: process.env.TEST_POSTGRES_HOST || 'localhost',
		POSTGRES_PORT: process.env.TEST_POSTGRES_PORT || '5432',
		POSTGRES_DB: process.env.TEST_POSTGRES_DB,
		POSTGRES_USER: process.env.TEST_POSTGRES_USER,
		POSTGRES_PASSWORD: process.env.TEST_POSTGRES_PASSWORD,
		DATA_DIR: mkdtempSync(join(tmpdir(), 'passport-compta-'))
	}
}));

const { closeDb, getDb } = await import('$lib/server/db');
const { migrations, runMigrations } = await import('$lib/server/migrations');
const { createTiers } = await import('$lib/server/compta/tiers');
const { createFacture, creerNoteDeCredit, getFacture, validerFacture, FactureError } = await import('$lib/server/compta/factures');
const { autoLettrer, createCompte, createMouvement, delettrer, getMouvement, lettrer, BanqueError } = await import('$lib/server/compta/banque');
const { listCotisations } = await import('$lib/server/compta/cotisations');

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function unTiers(nom = 'Client SRL') {
	return createTiers({
		nature: 'personne_morale',
		nom,
		prenom: null,
		email: null,
		telephone: null,
		adresse: null,
		codePostal: null,
		ville: null,
		pays: 'BE',
		numeroEntreprise: null,
		iban: null,
		exempteCotisation: false,
		estClient: false,
		estFournisseur: false,
		actif: true,
		notes: null
	});
}

// Each test draws its numbers from its own year: the sequence is per year and shared by everything.
async function factureValidee(tiersId: number, total: number, annee: number, cotisation: { debut: string; fin: string } | null = null) {
	const f = await createFacture({
		sens: 'emise',
		tiersId,
		dateEmission: day(`${annee}-03-01`),
		dateEcheance: null,
		objet: null,
		note: null,
		numero: null,
		lignes: [{ libelle: 'Cotisation', quantite: 1, prixUnitaire: total }],
		cotisation: cotisation ? { type: 'facturee', debut: day(cotisation.debut), fin: day(cotisation.fin), sieges: 1 } : null
	});
	return validerFacture(f.id);
}

let compteId: number;
async function entree(montant: number, communication: string | null = null) {
	return createMouvement({ compteId, dateValeur: day('2026-04-02'), montant, libelle: 'VIREMENT', contrepartieNom: null, contrepartieIban: null, communication });
}

describe.skipIf(!enabled)('compta sur une base réelle', () => {
	beforeAll(async () => {
		const admin = postgres({ ...target, onnotice: () => {} });
		await admin.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
		await admin.end();
		await getDb();
		compteId = (await createCompte({ type: 'banque', nom: 'Belfius', iban: null, soldeOuverture: 0, dateOuverture: day('2020-01-01'), actif: true })).id;
	}, 60_000);

	afterAll(async () => {
		await closeDb();
	});

	describe('migrations', () => {
		it('apply in full on an empty database, once', async () => {
			const sql = await getDb();
			const [{ count }] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM schema_migrations`;
			expect(count).toBe(migrations.length);
			await runMigrations(sql);
			const [{ count: again }] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM schema_migrations`;
			expect(again).toBe(migrations.length);
		});
	});

	describe('numérotation des factures émises', () => {
		it('numbers per year, gapless, from 0001', async () => {
			const t = await unTiers();
			const numeros = [];
			for (const annee of [2031, 2031, 2031, 2032]) numeros.push((await factureValidee(t.id, 10, annee)).numero);
			expect(numeros).toEqual(['2031-0001', '2031-0002', '2031-0003', '2032-0001']);
		});

		it('never gives the same number twice, even to validations running at the same time', async () => {
			const t = await unTiers();
			const brouillons = await Promise.all(
				[...Array(12).keys()].map(() =>
					createFacture({ sens: 'emise', tiersId: t.id, dateEmission: day('2033-01-15'), dateEcheance: null, objet: null, note: null, numero: null, lignes: [{ libelle: 'x', quantite: 1, prixUnitaire: 5 }], cotisation: null })
				)
			);
			const valides = await Promise.all(brouillons.map((b) => validerFacture(b.id)));
			expect(valides.map((f) => f.numero).sort()).toEqual([...Array(12).keys()].map((i) => `2033-${String(i + 1).padStart(4, '0')}`));
		});

		it('does not use up a number when validation is refused', async () => {
			const t = await unTiers();
			const premiere = await factureValidee(t.id, 10, 2034);
			await expect(validerFacture(premiere.id)).rejects.toThrow(FactureError);
			expect((await factureValidee(t.id, 10, 2034)).numero).toBe('2034-0002');
		});

		it('freezes the number with its structured communication, PDF and UBL', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 42, 2035);
			expect(f).toMatchObject({ statut: 'validee', numero: '2035-0001', hasPdf: true, hasUbl: true });
			expect(f.communicationStructuree?.replace(/\D/g, '').slice(0, 10)).toBe('2035000001');
			expect(f.dateEcheance).not.toBeNull();
		});
	});

	describe('lettrage', () => {
		it('settles an invoice once its payments add up, and the cotisation it announced with it', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 100, 2040, { debut: '2026-01-01', fin: '2027-01-01' });
			expect((await listCotisations(t.id)).map((c) => c.statut)).toEqual(['attendue']);

			await lettrer((await entree(60)).id, { type: 'facture', id: f.id }, 60);
			expect((await getFacture(f.id))?.statut).toBe('validee');
			await lettrer((await entree(40)).id, { type: 'facture', id: f.id }, 40);
			expect((await getFacture(f.id))?.statut).toBe('payee');
			expect((await listCotisations(t.id)).map((c) => c.statut)).toEqual(['active']);
		});

		it('refuses to allocate more than the invoice still owes or the movement still has', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 50, 2041);
			const m = await entree(80);
			await expect(lettrer(m.id, { type: 'facture', id: f.id }, 60)).rejects.toThrow(BanqueError);
			await expect(lettrer(m.id, { type: 'facture', id: f.id }, 90)).rejects.toThrow(BanqueError);
			await lettrer(m.id, { type: 'facture', id: f.id }, 50);
			expect((await getMouvement(m.id))?.reste).toBe(30);
		});

		it('refuses money going the wrong way for the document', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 20, 2042);
			await expect(lettrer((await entree(-20)).id, { type: 'facture', id: f.id }, 20)).rejects.toThrow(BanqueError);
		});

		it('puts the invoice and its cotisation back to unpaid when an allocation is removed', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 30, 2043, { debut: '2026-01-01', fin: '2027-01-01' });
			const l = await lettrer((await entree(30)).id, { type: 'facture', id: f.id }, 30);
			await delettrer(l.id);
			expect((await getFacture(f.id))?.statut).toBe('validee');
			expect((await listCotisations(t.id)).map((c) => c.statut)).toEqual(['attendue']);
		});

		// The import's automatic matching and a treasurer clicking at the same moment, or a double
		// click: both checks pass before either allocation is written, and the invoice is paid twice.
		it('never lets two simultaneous allocations pay the same invoice twice', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 100, 2044);
			const [a, b] = [await entree(100), await entree(100)];
			const results = await Promise.allSettled([lettrer(a.id, { type: 'facture', id: f.id }, 100), lettrer(b.id, { type: 'facture', id: f.id }, 100)]);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect((await getFacture(f.id))?.lettre).toBe(100);
		});

		it('never lets two simultaneous allocations spend the same movement twice', async () => {
			const t = await unTiers();
			const [f1, f2] = [await factureValidee(t.id, 100, 2045), await factureValidee(t.id, 100, 2045)];
			const m = await entree(100);
			const results = await Promise.allSettled([lettrer(m.id, { type: 'facture', id: f1.id }, 100), lettrer(m.id, { type: 'facture', id: f2.id }, 100)]);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect((await getMouvement(m.id))?.reste).toBe(0);
		});
	});

	describe('lettrage automatique', () => {
		it('matches the structured communication whatever its formatting, and only what is owed', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 75, 2046);
			const digits = f.communicationStructuree!.replace(/\D/g, '');
			const m = await entree(100, `***${digits.slice(0, 3)}/${digits.slice(3, 7)}/${digits.slice(7)}***`);
			expect(await autoLettrer([m.id])).toBe(1);
			expect((await getFacture(f.id))?.statut).toBe('payee');
			expect((await getMouvement(m.id))?.reste).toBe(25);
		});

		it('leaves alone a movement whose communication names no invoice of ours', async () => {
			const m = await entree(10, '+++000/0000/00097+++');
			expect(await autoLettrer([m.id])).toBe(0);
			expect((await getMouvement(m.id))?.reste).toBe(10);
		});
	});

	describe('note de crédit', () => {
		it('cancels the original invoice and the cotisation it announced', async () => {
			const t = await unTiers();
			const f = await factureValidee(t.id, 40, 2047, { debut: '2026-01-01', fin: '2027-01-01' });
			const nc = await creerNoteDeCredit(f.id);
			await validerFacture(nc.id);
			expect((await getFacture(f.id))?.statut).toBe('annulee');
			expect((await listCotisations(t.id)).map((c) => c.statut)).toEqual(['annulee']);
		});
	});
});
