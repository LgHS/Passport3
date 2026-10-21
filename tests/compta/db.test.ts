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
const { importDolibarr } = await import('$lib/server/compta/importDolibarr');
const { chargerPassport, comparer } = await import('$lib/server/compta/controleDolibarr');
const { brusselsToday, addUTCDays } = await import('$lib/server/compta/dates');
type DonneesDolibarr = import('$lib/server/compta/importDolibarr').DonneesDolibarr;

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Dolibarr dates are epoch seconds; noon UTC is the same calendar day in Brussels all year round.
const epoch = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12) / 1000);

// A small but complete Dolibarr: members in order, in grace and expired, a company member with its
// contact, an honorary member, a plain client, an issued and a received invoice, a bank account with
// its opening balance. Relative to today, so the "in order" check has something to compare.
function dolibarrDeTest(): DonneesDolibarr {
	const today = brusselsToday();
	const rel = (days: number) => epoch(addUTCDays(today, days));
	return {
		types: [
			{ id: 1, label: 'Membre', subscriptionRequired: true },
			{ id: 2, label: 'Membre d’honneur', subscriptionRequired: false }
		],
		members: [
			{ id: 101, statut: 1, morphy: 'phy', typeid: 1, firstname: 'Alice', lastname: 'Martin', email: 'alice@exemple.test', array_options: { options_iban_perso: 'BE71 0961 2345 6769' } },
			{ id: 102, statut: 1, morphy: 'phy', typeid: 1, firstname: 'Bruno', lastname: 'Leroy', email: 'bruno@exemple.test' },
			{ id: 103, statut: 1, morphy: 'phy', typeid: 1, firstname: 'Chloé', lastname: 'Dubois', email: null },
			{ id: 104, statut: 1, morphy: 'mor', typeid: 1, fk_soc: 201, firstname: 'Denis', lastname: 'Petit', email: 'denis@atelier.test' },
			{ id: 105, statut: 1, morphy: 'phy', typeid: 2, firstname: 'Eva', lastname: 'Honneur', email: null }
		],
		thirdParties: [
			{ id: 201, name: 'Atelier SRL', typent_code: 'TE_SMALL', idprof1: '0123456789', client: 1 },
			{ id: 202, name: 'Fournil SRL', typent_code: 'TE_SMALL', fournisseur: 1 }
		],
		subscriptionsByMember: new Map([
			[101, [{ rowid: 1001, dateh: rel(-200), datef: rel(165), amount: '120.00' }]],
			[102, [{ rowid: 1002, dateh: rel(-395), datef: rel(-30), amount: '120.00' }]],
			[103, [{ rowid: 1003, dateh: rel(-800), datef: rel(-400), amount: '60.00' }]],
			[104, [{ rowid: 1004, dateh: rel(-100), datef: rel(265), amount: '300.00' }]],
			[105, []]
		]),
		invoices: [
			{ id: 301, ref: 'FA2026-0001', socid: 201, statut: 2, paye: 1, date: rel(-90), total_ttc: '300.00', lines: [{ desc: 'Cotisation société', qty: 1, total_ttc: '300.00' }] },
			{ id: 302, ref: 'FA2026-0002', socid: 201, statut: 1, paye: 0, date: rel(-10), total_ttc: '45.50', lines: [{ desc: 'Atelier', qty: 2, total_ttc: '45.50' }] },
			{ id: 303, ref: '(PROV303)', socid: 201, statut: 0, total_ttc: '10.00' }
		],
		supplierInvoices: [{ id: 401, ref: 'SI2026-0001', ref_supplier: 'F-77', socid: 202, statut: 2, paye: 1, date: rel(-60), total_ttc: '82.15', lines: [{ desc: 'Pain', qty: 1, total_ttc: '82.15' }] }],
		bankAccounts: [{ id: 501, label: 'Belfius', type: 0, iban: 'BE68 5390 0754 7034', status: 0 }],
		bankLinesByAccount: new Map([
			[
				501,
				[
					{ id: 9001, datev: rel(-400), amount: '1500.00', label: '(Solde initial)' },
					{ id: 9002, datev: rel(-90), amount: '300.00', label: 'Atelier SRL' },
					{ id: 9003, datev: rel(-60), amount: '-82.15', label: 'Fournil' }
				]
			]
		]),
		authentikUsers: [{ pk: 77, email: 'alice@exemple.test' }]
	};
}

async function nombre(table: string): Promise<number> {
	const sql = await getDb();
	const [{ count }] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM ${sql(table)}`;
	return count;
}

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

	// Last in the file on purpose: the counts below include what the tests above created.
	describe('reprise Dolibarr', () => {
		it('a dry run writes nothing', async () => {
			const avant = await Promise.all(['tiers', 'cotisations', 'factures', 'mouvements'].map(nombre));
			const report = await importDolibarr(true, dolibarrDeTest());
			expect(report.tiers.created).toBeGreaterThan(0);
			expect(await Promise.all(['tiers', 'cotisations', 'factures', 'mouvements'].map(nombre))).toEqual(avant);
		});

		it('imports members, companies, cotisations, invoices and the bank account', async () => {
			const report = await importDolibarr(false, dolibarrDeTest());
			// Five members, the company's contact person, two third parties (one is member 104's).
			expect(report.tiers.created).toBe(7);
			expect(report.liens.created).toBe(1);
			expect(report.cotisations.created).toBe(4);
			// The draft is skipped: never issued.
			expect(report.factures.created).toBe(3);
			expect(report.comptes.created).toBe(1);
			expect(report.mouvements.created).toBe(2);
			expect(report.authentikLinked).toBe(1);

			const sql = await getDb();
			const [compte] = await sql<{ solde_ouverture: string }[]>`SELECT solde_ouverture FROM comptes WHERE dolibarr_bank_id = 501`;
			expect(Number(compte.solde_ouverture)).toBe(1500);
			const [alice] = await sql<{ authentik_pk: number; iban: string }[]>`SELECT authentik_pk, iban FROM tiers WHERE dolibarr_member_id = 101`;
			expect(alice).toEqual({ authentik_pk: 77, iban: 'BE71096123456769' });
		});

		it('can be run again without duplicating anything', async () => {
			const avant = await Promise.all(['tiers', 'tiers_liens', 'cotisations', 'factures', 'mouvements', 'comptes'].map(nombre));
			const report = await importDolibarr(false, dolibarrDeTest());
			expect([report.tiers.created, report.liens.created, report.cotisations.created, report.factures.created, report.comptes.created, report.mouvements.created]).toEqual([0, 0, 0, 0, 0, 0]);
			expect(await Promise.all(['tiers', 'tiers_liens', 'cotisations', 'factures', 'mouvements', 'comptes'].map(nombre))).toEqual(avant);
		});

		it('passes its own control report: same tiers, invoices, cotisations, balance and members in order', async () => {
			const today = brusselsToday();
			const rapport = comparer(dolibarrDeTest(), await chargerPassport(today), today);
			expect(rapport.ecarts).toEqual([]);
			expect(rapport.lignes.every((l) => l.ok)).toBe(true);
			expect(rapport.lignes.find((l) => l.domaine === 'Solde Belfius')?.passport.replace(/\s/g, ' ')).toBe('1 717,85 €');
			// Alice (paid), the company member Atelier SRL (paid) and Eva (honorary). Bruno is in
			// Passport's grace period — not in order on either side — and Chloé expired.
			expect(rapport.lignes.find((l) => l.domaine === 'En ordre aujourd’hui')).toMatchObject({ dolibarr: '3', passport: '3' });
		});

		it('names each difference once Passport no longer matches Dolibarr', async () => {
			const sql = await getDb();
			await sql`UPDATE factures SET total = 45.00 WHERE dolibarr_invoice_id = 302`;
			await sql`DELETE FROM cotisations WHERE dolibarr_subscription_id = 1001`;
			await sql`DELETE FROM mouvements WHERE external_id = 'dolibarr-9003'`;
			const today = brusselsToday();
			const rapport = comparer(dolibarrDeTest(), await chargerPassport(today), today);
			// Intl puts a non-breaking space before the € sign.
			const details = rapport.ecarts.map((e) => `${e.domaine} — ${e.detail}`.replace(/\s/g, ' '));
			expect(details).toEqual(
				expect.arrayContaining([
					expect.stringMatching(/^Factures émises — FA2026-0002 : 45,50 € dans Dolibarr, 45,00 € dans Passport\.$/),
					expect.stringMatching(/^Cotisations — Alice Martin : souscription 1001 du \d{4}-\d{2}-\d{2} absente de Passport\.$/),
					expect.stringMatching(/^Solde Belfius — Écart de 82,15 €\.$/),
					'En ordre aujourd’hui — Alice Martin : en ordre dans Dolibarr, en attente dans Passport.'
				])
			);
			expect(rapport.lignes.filter((l) => !l.ok).map((l) => l.domaine)).toEqual(['Factures émises', 'Cotisations', 'Solde Belfius', 'En ordre aujourd’hui']);
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
