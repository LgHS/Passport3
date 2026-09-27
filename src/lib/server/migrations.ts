import type postgres from 'postgres';

interface Migration {
	version: number;
	name: string;
	up: (sql: postgres.TransactionSql) => Promise<void>;
}

// Append-only: a migration that already shipped must never be edited, reordered, or removed — a
// fresh deploy and an already-running one both have to end up applying the exact same sequence in
// the same order. Fixing a mistake in an already-shipped migration means adding a new one that
// corrects it, not editing the old entry. Add a feature's table here instead of a module-local
// `CREATE TABLE IF NOT EXISTS` — see PR #46's review for why: one place to see what tables exist
// and in what order they were introduced, instead of each module quietly rolling its own.
const migrations: Migration[] = [
	{
		version: 1,
		name: 'create audit_events',
		up: async (sql) => {
			await sql`
				CREATE TABLE audit_events (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					actor_sub TEXT NOT NULL,
					actor_label TEXT NOT NULL,
					action TEXT NOT NULL,
					target_pk INTEGER,
					target_email TEXT,
					details TEXT
				)
			`;
			// Speeds up listAuditEventsForTarget()'s WHERE target_pk = ? ORDER BY id DESC — without
			// it, that query is a full table scan. Negligible today, but cheap before the table grows.
			await sql`CREATE INDEX audit_events_target_pk_id ON audit_events(target_pk, id DESC)`;
		}
	},
	{
		version: 2,
		name: 'add audit_events.source',
		up: async (sql) => {
			// 'admin' backfill for every pre-existing row: this column didn't exist before the
			// admin/user distinction did, so every row logged before it shipped was an admin action.
			await sql`ALTER TABLE audit_events ADD COLUMN source TEXT NOT NULL DEFAULT 'admin'`;
		}
	},
	{
		version: 3,
		name: 'create wishlist_items and wishlist_votes',
		up: async (sql) => {
			await sql`
				CREATE TABLE wishlist_items (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					author_sub TEXT NOT NULL,
					author_label TEXT NOT NULL,
					title TEXT NOT NULL,
					description TEXT,
					link TEXT,
					quantity INTEGER NOT NULL DEFAULT 1,
					-- DOUBLE PRECISION, not REAL: Postgres' REAL is 4 bytes (~7 significant digits),
					-- unlike SQLite's 8-byte REAL this column was first written for.
					estimated_amount DOUBLE PRECISION,
					type TEXT NOT NULL
				)
			`;
			// References wishlist_items, so must be created after it. Postgres enforces foreign keys
			// unconditionally (unlike SQLite, which needed `PRAGMA foreign_keys = ON`).
			await sql`
				CREATE TABLE wishlist_votes (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					item_id INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
					voter_sub TEXT NOT NULL,
					voter_label TEXT NOT NULL,
					value INTEGER NOT NULL,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					UNIQUE(item_id, voter_sub)
				)
			`;
		}
	},
	{
		version: 4,
		name: 'add wishlist_items.status and resolved_at',
		up: async (sql) => {
			// Every pre-existing row predates resolution, hence the 'pending' default/backfill.
			await sql`ALTER TABLE wishlist_items ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`;
			await sql`ALTER TABLE wishlist_items ADD COLUMN resolved_at TIMESTAMPTZ`;
		}
	},
	{
		// Renumbered from birthday-scheduler's own 1/2 to continue after audit-log/wishlist's 1-4 —
		// these were developed on sibling branches that each numbered from 1 independently. See
		// the migrations backfill TODO in project memory for why this collision was expected.
		version: 5,
		name: 'create birthday_settings',
		up: async (sql) => {
			// Single-row settings table (CHECK(id = 1) keeps it that way) rather than a generic
			// key/value table — there's exactly one setting pair to store today.
			await sql`
				CREATE TABLE birthday_settings (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					enabled BOOLEAN NOT NULL DEFAULT false,
					hour INTEGER NOT NULL DEFAULT 9
				)
			`;
			await sql`INSERT INTO birthday_settings (id, enabled, hour) VALUES (1, false, 9)`;
		}
	},
	{
		version: 6,
		name: 'create birthday_sent',
		up: async (sql) => {
			await sql`
				CREATE TABLE birthday_sent (
					member_pk INTEGER NOT NULL,
					year INTEGER NOT NULL,
					sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					PRIMARY KEY (member_pk, year)
				)
			`;
		}
	},
	{
		version: 7,
		name: 'create member_avatars',
		up: async (sql) => {
			// One row per member who uploaded a photo — no row means "show generated initials". The
			// file is named after the md5 hash of the member's email (see avatars.ts), so Authentik
			// and BookStack can reference it from the email alone, like a Gravatar.
			await sql`
				CREATE TABLE member_avatars (
					member_pk INTEGER PRIMARY KEY,
					file TEXT NOT NULL,
					updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
				)
			`;
		}
	},
	{
		version: 8,
		name: 'create avatar_variants',
		up: async (sql) => {
			// Background colour picked by a member for their generated initials avatar ("Changer de
			// couleur" on /profile), keyed by the same email hash as the avatar URL. No row means the
			// default colour derived from the hash itself.
			await sql`
				CREATE TABLE avatar_variants (
					email_hash TEXT PRIMARY KEY,
					variant INTEGER NOT NULL
				)
			`;
		}
	},
	{
		version: 9,
		name: 'drop member_avatars and avatar_variants',
		up: async (sql) => {
			// Avatars no longer use the database at all (see avatars.ts): whether a member uploaded
			// a photo is read from the disk, and their chosen colour is an Authentik attribute.
			await sql`DROP TABLE member_avatars`;
			await sql`DROP TABLE avatar_variants`;
		}
	},
	{
		version: 10,
		name: 'create compta: tiers, tiers_liens, abonnements, cotisations, compta_settings',
		up: async (sql) => {
			// The accounting module's foundation — see docs/compta.md for the model these tables
			// implement. Column names are French on purpose: they mirror the vocabulary the treasury
			// and the CA use (tiers, cotisation, abonnement), which is also what the UI shows.
			await sql`
				CREATE TABLE tiers (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					nature TEXT NOT NULL CHECK (nature IN ('personne_physique', 'personne_morale')),
					-- Family name for a person, legal name for an organisation.
					nom TEXT NOT NULL,
					prenom TEXT,
					email TEXT,
					telephone TEXT,
					adresse TEXT,
					code_postal TEXT,
					ville TEXT,
					pays TEXT NOT NULL DEFAULT 'BE',
					-- Belgian enterprise number (BCE/KBO), organisations only.
					numero_entreprise TEXT,
					-- One IBAN per tiers: a person's own, or an organisation's. The old Dolibarr split
					-- (ibanPerso on the member, ibanPro on the third party) maps to two tiers here.
					iban TEXT,
					-- Authentik user pk (= the OIDC \`sub\`), persons with a Passport account only. UNIQUE:
					-- one account is one person.
					authentik_pk INTEGER UNIQUE,
					-- Dolibarr's "member type without subscription" (membre d'honneur): a member who owes
					-- nothing, status non_applicable.
					exempte_cotisation BOOLEAN NOT NULL DEFAULT false,
					-- Roles are cumulative facts, not a type (see docs/compta.md, "Tiers"). Adhérent,
					-- sponsor and membre aren't columns: they follow from cotisations and liens.
					est_client BOOLEAN NOT NULL DEFAULT false,
					est_fournisseur BOOLEAN NOT NULL DEFAULT false,
					actif BOOLEAN NOT NULL DEFAULT true,
					notes TEXT,
					-- Import keys, so the Dolibarr import can be re-run without duplicating anything.
					-- A Dolibarr member and its billing third party may both land on one tiers.
					dolibarr_member_id INTEGER UNIQUE,
					dolibarr_soc_id INTEGER UNIQUE
				)
			`;
			// Login-time lookup falls back to the email when authentik_pk isn't linked yet (the
			// Dolibarr import only knows emails) — and the UI searches by name.
			await sql`CREATE INDEX tiers_lower_email ON tiers (lower(email))`;
			await sql`CREATE INDEX tiers_lower_nom ON tiers (lower(nom))`;

			await sql`
				CREATE TABLE tiers_liens (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					organisation_id INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
					personne_id INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
					-- Cumulative roles within the organisation (docs/compta.md, "Liens").
					est_employe BOOLEAN NOT NULL DEFAULT false,
					est_administrateur BOOLEAN NOT NULL DEFAULT false,
					est_contact BOOLEAN NOT NULL DEFAULT false,
					destinataire_factures BOOLEAN NOT NULL DEFAULT false,
					-- Does this person take one of the organisation's membership seats?
					herite_adhesion BOOLEAN NOT NULL DEFAULT false,
					-- A link is closed (jusqua set), never deleted, when someone leaves: the history of
					-- who was covered by which company is part of the books.
					depuis DATE NOT NULL DEFAULT CURRENT_DATE,
					jusqua DATE,
					CHECK (jusqua IS NULL OR jusqua > depuis),
					CHECK (organisation_id <> personne_id),
					UNIQUE (organisation_id, personne_id)
				)
			`;
			await sql`CREATE INDEX tiers_liens_personne ON tiers_liens (personne_id)`;

			await sql`
				CREATE TABLE abonnements (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					tiers_id INTEGER NOT NULL REFERENCES tiers(id),
					-- Invoice line label, e.g. "Affiliation Hackerspace 12 mois".
					libelle TEXT NOT NULL,
					-- NUMERIC, never a float, for money. postgres.js hands it back as a string; the
					-- compta modules convert it at the boundary.
					prix NUMERIC(12, 2) NOT NULL CHECK (prix >= 0),
					periodicite TEXT NOT NULL CHECK (periodicite IN ('mois', 'annee')),
					-- Seats granted per period, "défini au contrat".
					sieges INTEGER NOT NULL DEFAULT 1 CHECK (sieges >= 0),
					-- Start of the next period to invoice; the scheduler advances it after issuing.
					prochaine_echeance DATE NOT NULL,
					actif BOOLEAN NOT NULL DEFAULT true
				)
			`;
			await sql`CREATE INDEX abonnements_tiers ON abonnements (tiers_id)`;

			await sql`
				CREATE TABLE cotisations (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					tiers_id INTEGER NOT NULL REFERENCES tiers(id),
					type TEXT NOT NULL CHECK (type IN ('libre', 'facturee', 'sponsoring')),
					-- Covered period is [debut, fin): \`fin\` is the first day NOT covered, so consecutive
					-- cotisations share a boundary exactly and adjacency needs no tolerance (Dolibarr
					-- stored an inclusive end at 23:00, hence the old 24h tolerance).
					debut DATE NOT NULL,
					fin DATE NOT NULL,
					montant NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (montant >= 0),
					sieges INTEGER NOT NULL DEFAULT 1 CHECK (sieges >= 0),
					-- attendue = invoiced, not paid yet (grants nothing); active = paid, or a \`libre\`
					-- one created from a matched payment; annulee = never counts.
					statut TEXT NOT NULL DEFAULT 'active' CHECK (statut IN ('attendue', 'active', 'annulee')),
					abonnement_id INTEGER REFERENCES abonnements(id),
					-- facture_id comes with the factures table (phase 2).
					paye_le DATE,
					note TEXT,
					dolibarr_subscription_id INTEGER UNIQUE,
					CHECK (fin > debut)
				)
			`;
			await sql`CREATE INDEX cotisations_tiers_debut ON cotisations (tiers_id, debut)`;

			// Single-row settings table, same pattern as birthday_settings.
			await sql`
				CREATE TABLE compta_settings (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					-- Days after coverage ends before a member is deactivated (status en_grace → expiree).
					delai_grace_jours INTEGER NOT NULL DEFAULT 90 CHECK (delai_grace_jours >= 0)
				)
			`;
			await sql`INSERT INTO compta_settings (id) VALUES (1)`;
		}
	},
	{
		version: 11,
		name: 'create compta: factures, facture_lignes, facture_sequences; invoice settings',
		up: async (sql) => {
			// Issued and received invoices in one table, told apart by `sens` — see docs/compta.md,
			// "Factures". An issued invoice is mutable while `brouillon`; validation numbers it,
			// renders its PDF and freezes it (corrections go through a note de crédit).
			await sql`
				CREATE TABLE factures (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					sens TEXT NOT NULL CHECK (sens IN ('emise', 'recue')),
					type TEXT NOT NULL DEFAULT 'facture' CHECK (type IN ('facture', 'note_de_credit')),
					tiers_id INTEGER NOT NULL REFERENCES tiers(id),
					-- Ours (AAAA-NNNN, assigned at validation) for an issued invoice; the supplier's
					-- number for a received one.
					numero TEXT,
					statut TEXT NOT NULL DEFAULT 'brouillon'
						CHECK (statut IN ('brouillon', 'validee', 'payee', 'annulee')),
					date_emission DATE,
					date_echeance DATE,
					-- No VAT (franchise regime): the total is the sum of the lines, full stop.
					total NUMERIC(12, 2) NOT NULL DEFAULT 0,
					-- Short subject printed under the header, and free text printed at the bottom.
					objet TEXT,
					note TEXT,
					-- Belgian structured communication (+++NNN/NNNN/NNNNN+++) derived from the number,
					-- for automatic matching of the payment (phase 3).
					communication_structuree TEXT,
					-- The invoice a note de crédit cancels.
					facture_origine_id INTEGER REFERENCES factures(id),
					-- Number the document had in the previous system (Dolibarr ref), for the archive.
					reference_externe TEXT,
					-- The documents themselves, in the database rather than on the data volume: one store
					-- to back up, and a row can never point at a missing file. The PDF of an issued invoice
					-- is generated once at validation and never regenerated: what was sent must stay
					-- reproducible. Never selected in lists (see factures.ts's has_pdf), only on download.
					pdf BYTEA,
					ubl BYTEA,
					payee_le DATE,
					-- Optional dues block: when set, validation creates the matching cotisation
					-- (attendue) and payment activates it. cotisation_fin is exclusive like
					-- cotisations.fin.
					cotisation_type TEXT CHECK (cotisation_type IN ('facturee', 'sponsoring')),
					cotisation_debut DATE,
					cotisation_fin DATE,
					cotisation_sieges INTEGER,
					dolibarr_invoice_id INTEGER UNIQUE,
					dolibarr_supplier_invoice_id INTEGER UNIQUE,
					CHECK (cotisation_type IS NULL OR (cotisation_debut IS NOT NULL AND cotisation_fin IS NOT NULL AND cotisation_fin > cotisation_debut))
				)
			`;
			// Our own numbering must be unique; two suppliers may well reuse a number between them.
			await sql`CREATE UNIQUE INDEX factures_numero_emise ON factures (numero) WHERE sens = 'emise'`;
			await sql`CREATE INDEX factures_tiers_date ON factures (tiers_id, date_emission DESC)`;

			await sql`
				CREATE TABLE facture_lignes (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
					ordre INTEGER NOT NULL,
					libelle TEXT NOT NULL,
					quantite NUMERIC(12, 3) NOT NULL DEFAULT 1,
					prix_unitaire NUMERIC(12, 2) NOT NULL,
					total NUMERIC(12, 2) NOT NULL
				)
			`;
			await sql`CREATE INDEX facture_lignes_facture ON facture_lignes (facture_id, ordre)`;

			// One row per year: the last number handed out. Read and bumped under an advisory lock
			// at validation (factures.ts), which is what makes the sequence gapless.
			await sql`
				CREATE TABLE facture_sequences (
					annee INTEGER PRIMARY KEY,
					dernier INTEGER NOT NULL DEFAULT 0
				)
			`;

			await sql`ALTER TABLE cotisations ADD COLUMN facture_id INTEGER REFERENCES factures(id)`;

			// What the PDF prints about the issuer, editable from /compta/parametres. Defaults are
			// what the footer already shows; the address is for the treasury to fill in.
			await sql`
				ALTER TABLE compta_settings
					ADD COLUMN emetteur_nom TEXT NOT NULL DEFAULT 'Liège Hackerspace ASBL',
					ADD COLUMN emetteur_adresse TEXT NOT NULL DEFAULT '',
					ADD COLUMN emetteur_numero_entreprise TEXT NOT NULL DEFAULT '0649.448.256',
					ADD COLUMN emetteur_email TEXT NOT NULL DEFAULT 'compta@lghs.be',
					ADD COLUMN emetteur_iban TEXT NOT NULL DEFAULT '',
					ADD COLUMN mention_tva TEXT NOT NULL DEFAULT 'Régime particulier de franchise des petites entreprises — TVA non applicable (art. 56bis CTVA)',
					ADD COLUMN delai_paiement_jours INTEGER NOT NULL DEFAULT 30 CHECK (delai_paiement_jours >= 0)
			`;
		}
	}
];

// Arbitrary, fixed constant identifying Passport3's own migration lock — only matters if another
// application ever takes an advisory lock with this exact number on the very same Postgres
// instance, which isn't the case here.
const MIGRATION_LOCK_ID = 727300001;

export async function runMigrations(sql: postgres.Sql): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`;

	const sorted = [...migrations].sort((a, b) => a.version - b.version);
	for (const migration of sorted) {
		await sql.begin(async (tx) => {
			// Held only for this transaction, released automatically on commit/rollback. Guards
			// against two processes starting at the same time (a redeploy, more than one replica) both
			// applying the same migration — db.ts's promise memoization only protects a single
			// process, this is the cross-process equivalent.
			await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;

			// Re-read after acquiring the lock, not before: another process may have applied this
			// exact migration while this one was waiting for the lock.
			const [already] = await tx<{ version: number }[]>`
				SELECT version FROM schema_migrations WHERE version = ${migration.version}
			`;
			if (already) return;

			await migration.up(tx);
			await tx`INSERT INTO schema_migrations (version, name) VALUES (${migration.version}, ${migration.name})`;
		});
	}
}
