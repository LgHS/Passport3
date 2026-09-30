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
		name: 'create tasks',
		up: async (sql) => {
			// First shape of the task board (one assignee per task). Kept exactly as it first ran:
			// migration 11 below turns it into the current shape.
			await sql`
				CREATE TABLE tasks (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					author_sub TEXT NOT NULL,
					author_label TEXT NOT NULL,
					title TEXT NOT NULL,
					description TEXT,
					due_date DATE,
					status TEXT NOT NULL DEFAULT 'todo',
					assignee_sub TEXT,
					assignee_label TEXT,
					assigned_by_sub TEXT,
					done_at TIMESTAMPTZ
				)
			`;
		}
	},
	{
		version: 11,
		name: 'tasks: several members, leader, blocked state',
		up: async (sql) => {
			// Written to work on any database that ran a draft of migration 10 (whichever shape it
			// had), hence the IF [NOT] EXISTS everywhere.
			// Everyone on a task: volunteers (assigned_by_sub null) and members an admin put on it
			// (assigned_by_sub set — they can't remove themselves). At most one leader per task.
			await sql`
				CREATE TABLE IF NOT EXISTS task_members (
					task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
					member_sub TEXT NOT NULL,
					member_label TEXT NOT NULL,
					assigned_by_sub TEXT,
					is_leader BOOLEAN NOT NULL DEFAULT false,
					joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					PRIMARY KEY (task_id, member_sub)
				)
			`;
			await sql`
				CREATE UNIQUE INDEX IF NOT EXISTS task_members_one_leader ON task_members(task_id) WHERE is_leader
			`;

			// The single assignee of the first shape becomes the task's first member.
			const [{ has_assignee }] = await sql<{ has_assignee: boolean }[]>`
				SELECT EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_name = 'tasks' AND column_name = 'assignee_sub'
				) AS has_assignee
			`;
			if (has_assignee) {
				await sql`
					INSERT INTO task_members (task_id, member_sub, member_label, assigned_by_sub)
					SELECT id, assignee_sub, assignee_label, assigned_by_sub FROM tasks WHERE assignee_sub IS NOT NULL
					ON CONFLICT DO NOTHING
				`;
			}
			// "à faire" vs "en cours" is now derived from whether anyone is on the task, and "fait"
			// from done_at.
			await sql`
				ALTER TABLE tasks
					DROP COLUMN IF EXISTS status,
					DROP COLUMN IF EXISTS assignee_sub,
					DROP COLUMN IF EXISTS assignee_label,
					DROP COLUMN IF EXISTS assigned_by_sub,
					-- 'internal' (waiting on us: a decision, a purchase…) or 'external' (a supplier, a
					-- third party…), with a note saying what it's waiting on. NULL = not blocked.
					ADD COLUMN IF NOT EXISTS blocked_kind TEXT,
					ADD COLUMN IF NOT EXISTS blocked_note TEXT
			`;
		}
	},
	{
		version: 12,
		name: 'tasks: explicit start, per-task history',
		up: async (sql) => {
			// People on a task doesn't mean it has started: "en cours" is now an explicit step
			// ("Démarrer"), recorded here. NULL = not started.
			await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`;
			// Each task's own history, shown in its modal. Every entry is also written to
			// audit_events (see /tasks' +page.server.ts): this one is per task and goes away with it,
			// the audit log keeps everything.
			await sql`
				CREATE TABLE IF NOT EXISTS task_events (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					actor_label TEXT NOT NULL,
					action TEXT NOT NULL,
					details TEXT
				)
			`;
			await sql`CREATE INDEX IF NOT EXISTS task_events_task_id ON task_events(task_id, id)`;
		}
	},
	{
		version: 13,
		name: 'tasks: created_by_admin',
		up: async (sql) => {
			// Whether an admin created the task: its leader can delete a task, except one an admin
			// created. Existing rows default to false.
			await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by_admin BOOLEAN NOT NULL DEFAULT false`;
		}
	},
	{
		version: 14,
		name: 'tasks: priority',
		up: async (sql) => {
			// 1 Bas, 2 Moyen, 3 Normal, 4 Élevé, 5 Urgent (see $lib/taskPriority). Existing tasks: Normal.
			await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 3`;
		}
	},
	{
		version: 15,
		name: 'tasks: reminder tracking',
		up: async (sql) => {
			// Which due date each Mattermost reminder was already sent for (see taskReminders.ts):
			// one "due tomorrow" and one "overdue" reminder per due date, sent again only if the due
			// date is changed.
			await sql`
				ALTER TABLE tasks
					ADD COLUMN IF NOT EXISTS due_soon_reminded_for DATE,
					ADD COLUMN IF NOT EXISTS overdue_reminded_for DATE
			`;
		}
	},
	{
		version: 16,
		name: 'create app_settings',
		up: async (sql) => {
			// Small admin-editable settings that used to live in .env (e.g. which Mattermost channel
			// gets which announcement), one row per key. See appSettings.ts.
			await sql`
				CREATE TABLE IF NOT EXISTS app_settings (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL,
					updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
				)
			`;
		}
	},
	{
		version: 17,
		name: 'move birthday_settings into app_settings',
		up: async (sql) => {
			// Brings the birthday switch and hour next to the birthday channel, so all of a
			// feature's settings live in app_settings. ON CONFLICT DO NOTHING keeps a value already
			// saved there. birthday_settings itself is left in place (no longer read) so the
			// previous release still runs against this database if it has to be rolled back; it
			// can be dropped by a later migration.
			await sql`
				INSERT INTO app_settings (key, value)
				SELECT 'mattermost.birthday_enabled', 'true' FROM birthday_settings WHERE id = 1 AND enabled
				ON CONFLICT (key) DO NOTHING
			`;
			await sql`
				INSERT INTO app_settings (key, value)
				SELECT 'mattermost.birthday_hour', hour::text FROM birthday_settings WHERE id = 1
				ON CONFLICT (key) DO NOTHING
			`;
		}
	},
	{
		version: 18,
		name: 'drop birthday_settings',
		up: async (sql) => {
			// Unread since migration 17 moved its values into app_settings; kept until that release
			// was verified in production so a rollback still worked.
			await sql`DROP TABLE IF EXISTS birthday_settings`;
		}
	},
	{
		version: 19,
		name: 'create incidents',
		up: async (sql) => {
			// Member-filed declarations of what happened at the hackerspace, read by admins only.
			// `kind` is 'incident' (damage, or a near miss that hurt nobody) or 'accident' (someone
			// was injured) — the vocabulary lives in $lib/incidentDisplay.ts rather than in a CHECK
			// constraint, same as the wishlist's status.
			// `created_at` is when it was declared, `occurred_at` when it actually happened: the form
			// pre-fills the latter but lets it be corrected, so the two genuinely differ.
			// First-aid columns are only ever filled for an accident (the question isn't asked
			// otherwise), the fire-device ones for both — a fire put out with nobody hurt is exactly
			// the near-miss case `incident` is for.
			// No extra index: this table gains a handful of rows a year, the primary key covers the
			// single ORDER BY the list does.
			await sql`
				CREATE TABLE incidents (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					author_sub TEXT NOT NULL,
					author_label TEXT NOT NULL,
					kind TEXT NOT NULL,
					occurred_at TIMESTAMPTZ NOT NULL,
					people TEXT NOT NULL,
					visitor_involved BOOLEAN NOT NULL DEFAULT false,
					witnesses TEXT,
					equipment TEXT,
					description TEXT NOT NULL,
					emergency_services_called BOOLEAN NOT NULL DEFAULT false,
					first_aid_used BOOLEAN NOT NULL DEFAULT false,
					first_aid_details TEXT,
					fire_device_used BOOLEAN NOT NULL DEFAULT false,
					fire_device_details TEXT
				)
			`;
		}
	},
	{
		version: 20,
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
		version: 21,
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
	},
	{
		version: 22,
		name: 'create compta: comptes, mouvements, imports_bancaires, lettrages',
		up: async (sql) => {
			// Bank and cash accounts with their movements, and the matching (lettrage) of movements
			// against invoices, dues and expense claims — docs/compta.md, "Banque et caisse".
			await sql`
				CREATE TABLE comptes (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					type TEXT NOT NULL CHECK (type IN ('banque', 'caisse')),
					nom TEXT NOT NULL,
					iban TEXT,
					-- Balance before the first recorded movement; the current balance is this plus the
					-- sum of movements, computed on read.
					solde_ouverture NUMERIC(12, 2) NOT NULL DEFAULT 0,
					date_ouverture DATE NOT NULL DEFAULT CURRENT_DATE,
					actif BOOLEAN NOT NULL DEFAULT true,
					dolibarr_bank_id INTEGER UNIQUE
				)
			`;

			// One row per statement file imported, for the audit trail and for "where did this
			// movement come from".
			await sql`
				CREATE TABLE imports_bancaires (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					compte_id INTEGER NOT NULL REFERENCES comptes(id),
					nom_fichier TEXT NOT NULL,
					lignes INTEGER NOT NULL,
					nouvelles INTEGER NOT NULL,
					actor_sub TEXT NOT NULL
				)
			`;

			await sql`
				CREATE TABLE mouvements (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					compte_id INTEGER NOT NULL REFERENCES comptes(id),
					date_valeur DATE NOT NULL,
					-- Signed: money in is positive, money out negative.
					montant NUMERIC(12, 2) NOT NULL,
					libelle TEXT NOT NULL,
					contrepartie_nom TEXT,
					contrepartie_iban TEXT,
					communication TEXT,
					import_id INTEGER REFERENCES imports_bancaires(id),
					-- Bank-side identity of the line (statement + transaction number, or a hash of the
					-- row), so re-importing an overlapping export never duplicates a movement.
					external_id TEXT,
					-- Both legs of an internal transfer share the id of the first leg.
					transfert_id INTEGER,
					UNIQUE (compte_id, external_id)
				)
			`;
			await sql`CREATE INDEX mouvements_compte_date ON mouvements (compte_id, date_valeur DESC, id DESC)`;

			// One row per allocation of (part of) a movement to a target: a payment can settle
			// several invoices, an invoice can be paid in several times.
			await sql`
				CREATE TABLE lettrages (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					mouvement_id INTEGER NOT NULL REFERENCES mouvements(id) ON DELETE CASCADE,
					cible_type TEXT NOT NULL CHECK (cible_type IN ('facture', 'cotisation', 'note_de_frais', 'autre')),
					-- NULL only for 'autre' (a free-text allocation: bank fees, a donation…).
					cible_id INTEGER,
					-- Always positive; the movement's sign says which way the money went.
					montant NUMERIC(12, 2) NOT NULL CHECK (montant > 0),
					libelle TEXT,
					CHECK (cible_type = 'autre' OR cible_id IS NOT NULL)
				)
			`;
			await sql`CREATE INDEX lettrages_mouvement ON lettrages (mouvement_id)`;
			await sql`CREATE INDEX lettrages_cible ON lettrages (cible_type, cible_id)`;
		}
	},
	{
		version: 23,
		name: 'factures: envoi par email',
		up: async (sql) => {
			// When and to whom an issued invoice was last emailed (factureMail.ts) — shown on the
			// invoice, and what stops the scheduler from sending a subscription invoice twice.
			await sql`ALTER TABLE factures ADD COLUMN envoyee_le TIMESTAMPTZ, ADD COLUMN envoyee_a TEXT`;
		}
	},
	{
		version: 24,
		name: 'create notes_de_frais; automatic Authentik deactivation',
		up: async (sql) => {
			// Expense claims: a member submits, the treasury accepts or refuses, and the refund is a
			// bank movement matched against the claim (lettrages, cible note_de_frais) — docs/compta.md.
			await sql`
				CREATE TABLE notes_de_frais (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					tiers_id INTEGER NOT NULL REFERENCES tiers(id),
					date DATE NOT NULL,
					libelle TEXT NOT NULL,
					montant NUMERIC(12, 2) NOT NULL CHECK (montant > 0),
					statut TEXT NOT NULL DEFAULT 'soumise' CHECK (statut IN ('soumise', 'acceptee', 'refusee', 'remboursee')),
					-- The receipt, in the row like invoice PDFs.
					justificatif BYTEA,
					justificatif_nom TEXT,
					justificatif_type TEXT,
					decision_le TIMESTAMPTZ,
					decision_par TEXT,
					motif TEXT,
					remboursee_le DATE
				)
			`;
			await sql`CREATE INDEX notes_de_frais_tiers ON notes_de_frais (tiers_id, id DESC)`;
			await sql`CREATE INDEX notes_de_frais_statut ON notes_de_frais (statut)`;

			// Off by default: switching it on (from /compta/parametres) makes adhesionSync.ts deactivate
			// the Authentik account of members whose dues expired past the grace period, and reactivate
			// those it deactivated once they're covered again.
			await sql`ALTER TABLE compta_settings ADD COLUMN desactivation_auto BOOLEAN NOT NULL DEFAULT false`;
			// Only accounts Passport itself deactivated are ever reactivated by it.
			await sql`ALTER TABLE tiers ADD COLUMN desactive_le TIMESTAMPTZ`;
		}
	},
	{
		version: 25,
		name: 'create gmail_connexion, messages_releves, documents_recus',
		up: async (sql) => {
			// The treasury's Gmail mailbox (gmail.ts): one row, the OAuth refresh token encrypted.
			await sql`
				CREATE TABLE gmail_connexion (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					email TEXT NOT NULL,
					refresh_token TEXT NOT NULL,
					connecte_le TIMESTAMPTZ NOT NULL DEFAULT now(),
					connecte_par TEXT NOT NULL
				)
			`;

			// Every mail already collected from the mailbox (reception.ts), so that it's fetched
			// once — the mailbox itself is only ever read, never labelled or modified. The sender
			// check is kept with its evidence, for the treasurer to review.
			await sql`
				CREATE TABLE messages_releves (
					gmail_message_id TEXT PRIMARY KEY,
					releve_le TIMESTAMPTZ NOT NULL DEFAULT now(),
					recu_le TIMESTAMPTZ NOT NULL,
					expediteur TEXT NOT NULL,
					sujet TEXT NOT NULL,
					verifie BOOLEAN NOT NULL,
					verification JSONB NOT NULL
				)
			`;

			// The invoices found in those mails, waiting for the treasurer: nothing here is in the
			// books until it's imported (facture_id set) — see docs/compta.md, "Réception".
			await sql`
				CREATE TABLE documents_recus (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					gmail_message_id TEXT NOT NULL REFERENCES messages_releves(gmail_message_id),
					-- Rank of the document within its mail (a mail can carry several invoices).
					position INTEGER NOT NULL,
					statut TEXT NOT NULL DEFAULT 'a_traiter' CHECK (statut IN ('a_traiter', 'importe', 'ignore')),
					pdf BYTEA,
					pdf_nom TEXT,
					ubl BYTEA,
					ubl_nom TEXT,
					-- Read from the UBL when there is one, for the list; the import re-reads the file.
					fournisseur_nom TEXT,
					numero TEXT,
					date_emission DATE,
					total NUMERIC(12, 2),
					facture_id INTEGER REFERENCES factures(id) ON DELETE SET NULL,
					traite_le TIMESTAMPTZ,
					traite_par TEXT,
					UNIQUE (gmail_message_id, position),
					CHECK (pdf IS NOT NULL OR ubl IS NOT NULL)
				)
			`;
			await sql`CREATE INDEX documents_recus_statut ON documents_recus (statut, id DESC)`;

			// Sender domains accepted as "Doccle" (comma-separated), and how far back to look.
			await sql`
				ALTER TABLE compta_settings
					ADD COLUMN reception_domaines TEXT NOT NULL DEFAULT 'doccle.be',
					ADD COLUMN reception_auto BOOLEAN NOT NULL DEFAULT false
			`;
		}
	},
	{
		version: 26,
		name: 'create rappels',
		up: async (sql) => {
			// Payment reminders actually sent for an issued invoice (rappels.ts). A reminder is
			// proposed by the app and sent only once a treasurer picked it: what's here is history.
			await sql`
				CREATE TABLE rappels (
					id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
					-- 1 for the first reminder of an invoice, 2 for the second, and so on.
					niveau INTEGER NOT NULL CHECK (niveau >= 1),
					envoye_le TIMESTAMPTZ NOT NULL DEFAULT now(),
					envoye_a TEXT NOT NULL,
					envoye_par TEXT NOT NULL,
					-- What was still owed when the reminder left, and the text that was sent.
					reste NUMERIC(12, 2) NOT NULL,
					message TEXT NOT NULL
				)
			`;
			await sql`CREATE INDEX rappels_facture ON rappels (facture_id, id DESC)`;
			// Days past the due date before a first reminder is proposed, and between two reminders.
			await sql`
				ALTER TABLE compta_settings
					ADD COLUMN rappel_delai_jours INTEGER NOT NULL DEFAULT 14 CHECK (rappel_delai_jours >= 0)
			`;
		}
	},
	{
		version: 27,
		name: 'official headings, comptes_annuels, opening balances',
		up: async (sql) => {
			// The heading of the official statement (rubriques.ts) a document falls under, when the
			// treasurer chose one; NULL means the default for that kind of document.
			await sql`ALTER TABLE factures ADD COLUMN rubrique TEXT`;
			await sql`ALTER TABLE notes_de_frais ADD COLUMN rubrique TEXT`;
			await sql`ALTER TABLE cotisations ADD COLUMN rubrique TEXT`;
			await sql`ALTER TABLE lettrages ADD COLUMN rubrique TEXT`;

			// What the annual accounts need and the books can't know: the notes of the annexe, and
			// the assets, debts, rights and commitments that aren't bank balances or invoices.
			await sql`
				CREATE TABLE comptes_annuels (
					annee INTEGER PRIMARY KEY,
					updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
					updated_by TEXT NOT NULL,
					regles_evaluation TEXT NOT NULL DEFAULT '',
					adaptation_regles TEXT NOT NULL DEFAULT '',
					informations_complementaires TEXT NOT NULL DEFAULT '',
					-- Amounts keyed by line (comptesAnnuels.ts), and free text for what can't be quantified.
					montants JSONB NOT NULL DEFAULT '{}',
					droits_engagements_texte TEXT NOT NULL DEFAULT '',
					-- Date the general assembly approved the accounts, printed on the document.
					approuves_le DATE
				)
			`;

			// Dolibarr keeps an account's opening balance as a bank line ("Solde initial"); imported
			// as a movement it showed up as a receipt. It's the account's opening balance.
			const lignes = await sql<{ id: number; compte_id: number; date_valeur: string; montant: string }[]>`
				SELECT m.id, m.compte_id, m.date_valeur::text AS date_valeur, m.montant
				FROM mouvements m
				WHERE m.external_id LIKE 'dolibarr-%' AND m.libelle ~* '^\\(?\\s*(solde initial|initialbankbalance)\\s*\\)?$'
				  AND NOT EXISTS (SELECT 1 FROM lettrages l WHERE l.mouvement_id = m.id)
			`;
			for (const l of lignes) {
				await sql`
					UPDATE comptes SET solde_ouverture = solde_ouverture + ${l.montant}, date_ouverture = LEAST(date_ouverture, ${l.date_valeur}::date)
					WHERE id = ${l.compte_id}
				`;
				await sql`DELETE FROM mouvements WHERE id = ${l.id}`;
			}
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
