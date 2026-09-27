import type postgres from 'postgres';
import { getDb } from '$lib/server/db';
import { dolibarrApiFetch, downloadDolibarrDocument, getMemberTypes, parseDolibarrDate } from '$lib/server/dolibarr';
import { attachPdf } from './factures';
import { listUsers } from '$lib/server/authentikAdmin';
import { normalizeIban } from '$lib/server/bankValidation';
import { addUTCDays, brusselsToday, toIsoDate } from './dates';

// One-shot (but re-runnable) import of Dolibarr's members, third parties and subscriptions into the
// compta tables — the correspondence table is in docs/compta.md, "Migration depuis Dolibarr".
//
// Everything runs in one transaction: a dry run does the whole thing and rolls back, so the report
// it shows is exactly what a real run would do. Re-running is safe: rows are matched on their
// Dolibarr ids (tiers.dolibarr_member_id / dolibarr_soc_id, cotisations.dolibarr_subscription_id)
// and updated in place; hand-edited fields Dolibarr knows nothing about (notes, authentik_pk once
// set) are left alone.

export interface ImportCounts {
	created: number;
	updated: number;
}

export interface ImportReport {
	dryRun: boolean;
	tiers: ImportCounts;
	liens: ImportCounts;
	cotisations: ImportCounts;
	factures: ImportCounts;
	// Invoice PDFs fetched from Dolibarr and archived (never on a dry run).
	pdfs: number;
	// Persons whose Authentik account got linked by email during this run.
	authentikLinked: number;
	// Lines a treasurer should read: a member without a name, an email matched to no account, an
	// IBAN that failed validation…
	warnings: string[];
}

class DryRunRollback extends Error {}

// Raw Dolibarr shapes, only the fields this import reads. Dolibarr returns numbers as strings.
interface RawMember {
	id: string | number;
	statut: string | number;
	morphy?: 'phy' | 'mor' | string;
	typeid?: string | number | null;
	fk_adherent_type?: string | number | null;
	fk_soc?: string | number | null;
	socid?: string | number | null;
	societe?: string | null;
	firstname?: string | null;
	lastname?: string | null;
	email?: string | null;
	phone?: string | null;
	phone_perso?: string | null;
	phone_mobile?: string | null;
	address?: string | null;
	zip?: string | null;
	town?: string | null;
	country_code?: string | null;
	datec?: string | number | null;
	array_options?: { options_iban_perso?: string | null } | null;
}

interface RawThirdParty {
	id: string | number;
	name: string;
	status?: string | number;
	typent_code?: string | null;
	email?: string | null;
	phone?: string | null;
	address?: string | null;
	zip?: string | null;
	town?: string | null;
	country_code?: string | null;
	idprof1?: string | null;
	tva_intra?: string | null;
	client?: string | number;
	fournisseur?: string | number;
	array_options?: { options_iban_pro?: string | null } | null;
}

interface RawSubscription {
	rowid?: string | number;
	id?: string | number;
	dateh?: string | number | null;
	datef?: string | number | null;
	amount?: string | number;
	note_public?: string | null;
	note?: string | null;
}

function num(value: string | number | null | undefined): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function text(value: string | null | undefined): string | null {
	const t = value?.trim() ?? '';
	return t === '' ? null : t;
}

// Dolibarr dates are instants (epoch, Brussels midnight); the compta tables want the calendar day
// the treasury meant. brusselsToday() applied to that instant gives exactly that day.
function calendarDay(raw: string | number | null | undefined): Date | null {
	const instant = parseDolibarrDate(raw);
	return instant ? brusselsToday(instant) : null;
}

// Belgian enterprise number from Dolibarr's fields: idprof1 when filled, else the VAT number minus
// its BE prefix. Formatted 0xxx.xxx.xxx, the way it's printed on invoices.
function enterpriseNumber(tp: RawThirdParty): string | null {
	const raw = text(tp.idprof1) ?? text(tp.tva_intra)?.replace(/^be/i, '') ?? null;
	if (!raw) return null;
	const digits = raw.replace(/\D/g, '');
	if (digits.length !== 10) return raw; // foreign VAT numbers stay as they are
	return `${digits.slice(0, 4)}.${digits.slice(4, 7)}.${digits.slice(7)}`;
}

function iban(raw: string | null | undefined, warnings: string[], who: string): string | null {
	const value = normalizeIban(raw ?? '');
	if (!value) return null;
	// Kept even if the checksum fails — losing a treasurer-entered IBAN silently is worse than
	// importing one they'll have to fix — but flagged.
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) warnings.push(`${who} : IBAN au format douteux (${value}).`);
	return value;
}

interface TiersValues {
	nature: 'personne_physique' | 'personne_morale';
	nom: string;
	prenom: string | null;
	email: string | null;
	telephone: string | null;
	adresse: string | null;
	codePostal: string | null;
	ville: string | null;
	pays: string;
	numeroEntreprise: string | null;
	iban: string | null;
	exempteCotisation: boolean;
	estClient: boolean;
	estFournisseur: boolean;
	actif: boolean;
	dolibarrMemberId: number | null;
	dolibarrSocId: number | null;
}

async function fetchJson<T>(path: string): Promise<T> {
	const res = await dolibarrApiFetch(path);
	return (await res.json()) as T;
}

export async function importDolibarr(dryRun: boolean): Promise<ImportReport> {
	const report: ImportReport = {
		dryRun,
		tiers: { created: 0, updated: 0 },
		liens: { created: 0, updated: 0 },
		cotisations: { created: 0, updated: 0 },
		factures: { created: 0, updated: 0 },
		pdfs: 0,
		authentikLinked: 0,
		warnings: []
	};

	// Everything read up front, before the transaction opens — no HTTP inside the transaction.
	const [types, members, thirdParties, invoices, supplierInvoices, authentikUsers] = await Promise.all([
		getMemberTypes(),
		fetchJson<RawMember[]>('members?limit=0'),
		fetchJson<RawThirdParty[]>('thirdparties?limit=0'),
		fetchJson<RawInvoice[]>('invoices?limit=0'),
		fetchJson<RawSupplierInvoice[]>('supplierinvoices?limit=0'),
		listUsers()
	]);
	const exemptTypeIds = new Set(types.filter((t) => !t.subscriptionRequired).map((t) => t.id));
	const thirdPartyById = new Map(thirdParties.map((tp) => [Number(tp.id), tp]));
	const subscriptionsByMember = new Map<number, RawSubscription[]>();
	for (const m of members) {
		const id = Number(m.id);
		subscriptionsByMember.set(id, await fetchJson<RawSubscription[]>(`members/${id}/subscriptions`));
	}
	const authentikPkByEmail = new Map<string, number>();
	for (const u of authentikUsers) {
		if (u.email) authentikPkByEmail.set(u.email.toLowerCase(), u.pk);
	}

	const sql = await getDb();
	try {
		await sql.begin(async (tx) => {
			const claimedSocIds = new Set<number>();

			for (const m of members) {
				await importMember(tx, m, { types: exemptTypeIds, thirdPartyById, subscriptionsByMember, claimedSocIds }, report);
			}
			// Third parties no member claimed: plain clients/suppliers.
			for (const tp of thirdParties) {
				if (claimedSocIds.has(Number(tp.id))) continue;
				await upsertTiers(tx, thirdPartyValues(tp, report), report);
			}
			report.authentikLinked = await linkAuthentikAccounts(tx, authentikPkByEmail, report);

			const tiersBySocId = new Map<number, number>();
			for (const t of await tx<{ id: number; dolibarr_soc_id: number }[]>`SELECT id, dolibarr_soc_id FROM tiers WHERE dolibarr_soc_id IS NOT NULL`) {
				tiersBySocId.set(t.dolibarr_soc_id, t.id);
			}
			for (const inv of invoices) await importInvoice(tx, inv, tiersBySocId, report);
			for (const inv of supplierInvoices) await importSupplierInvoice(tx, inv, tiersBySocId, report);

			if (dryRun) throw new DryRunRollback();
		});
	} catch (err) {
		if (!(err instanceof DryRunRollback)) throw err;
	}

	// PDFs are fetched only once the rows are committed, and only the missing ones — a re-run
	// doesn't re-download the archive. Each failure is a warning, not a failed import.
	if (!dryRun) {
		report.pdfs = await archiveInvoicePdfs(invoices, supplierInvoices, report);
	}
	return report;
}

// ---------------------------------------------------------------------------------------------
// Invoices

interface RawInvoiceLine {
	desc?: string | null;
	description?: string | null;
	product_label?: string | null;
	qty?: string | number;
	subprice?: string | number;
	total_ttc?: string | number;
}

interface RawInvoice {
	id: string | number;
	ref: string;
	socid?: string | number;
	type?: string | number;
	statut?: string | number;
	status?: string | number;
	paye?: string | number;
	date?: string | number | null;
	date_lim_reglement?: string | number | null;
	total_ttc?: string | number;
	note_public?: string | null;
	last_main_doc?: string | null;
	lines?: RawInvoiceLine[];
}

interface RawSupplierInvoice {
	id: string | number;
	ref: string;
	ref_supplier?: string | null;
	label?: string | null;
	socid?: string | number;
	statut?: string | number;
	status?: string | number;
	paye?: string | number;
	date?: string | number | null;
	date_echeance?: string | number | null;
	total_ttc?: string | number;
	last_main_doc?: string | null;
	lines?: RawInvoiceLine[];
}

// Dolibarr FactureStatique: 0 draft, 1 validated, 2 paid (classée payée), 3 abandoned.
function invoiceStatut(raw: string | number | undefined, paye: string | number | undefined): 'validee' | 'payee' | 'annulee' | null {
	const statut = num(raw);
	if (statut === 0 || statut === null) return null;
	if (statut === 3) return 'annulee';
	return statut === 2 || num(paye) === 1 ? 'payee' : 'validee';
}

// One line per Dolibarr line, at the amount actually charged: TTC totals for supplier invoices
// (the ASBL pays VAT it can't recover), which equal HT on issued ones (no VAT charged).
function lineValues(l: RawInvoiceLine): { libelle: string; quantite: number; prixUnitaire: number; total: number } {
	const total = num(l.total_ttc) ?? 0;
	const quantite = num(l.qty) || 1;
	return {
		libelle: text(l.desc) ?? text(l.description) ?? text(l.product_label) ?? '—',
		quantite,
		prixUnitaire: Math.round((total / quantite) * 100) / 100,
		total
	};
}

async function upsertFacture(
	tx: postgres.TransactionSql,
	key: { dolibarrInvoiceId: number | null; dolibarrSupplierInvoiceId: number | null },
	f: {
		sens: 'emise' | 'recue';
		type: 'facture' | 'note_de_credit';
		tiersId: number;
		numero: string;
		statut: 'validee' | 'payee' | 'annulee';
		dateEmission: Date | null;
		dateEcheance: Date | null;
		total: number;
		note: string | null;
		referenceExterne: string;
	},
	lines: RawInvoiceLine[],
	report: ImportReport
): Promise<void> {
	const [existing] = await tx<{ id: number }[]>`
		SELECT id FROM factures
		WHERE (${key.dolibarrInvoiceId}::int IS NOT NULL AND dolibarr_invoice_id = ${key.dolibarrInvoiceId})
		   OR (${key.dolibarrSupplierInvoiceId}::int IS NOT NULL AND dolibarr_supplier_invoice_id = ${key.dolibarrSupplierInvoiceId})
	`;
	let id: number;
	if (existing) {
		id = existing.id;
		await tx`
			UPDATE factures SET tiers_id = ${f.tiersId}, statut = ${f.statut}, date_emission = ${f.dateEmission ? toIsoDate(f.dateEmission) : null},
				date_echeance = ${f.dateEcheance ? toIsoDate(f.dateEcheance) : null}, total = ${f.total}, note = COALESCE(note, ${f.note}),
				updated_at = now()
			WHERE id = ${id}
		`;
		report.factures.updated += 1;
	} else {
		const [row] = await tx<{ id: number }[]>`
			INSERT INTO factures (sens, type, tiers_id, numero, statut, date_emission, date_echeance, total, note, reference_externe,
			                      dolibarr_invoice_id, dolibarr_supplier_invoice_id)
			VALUES (${f.sens}, ${f.type}, ${f.tiersId}, ${f.numero}, ${f.statut}, ${f.dateEmission ? toIsoDate(f.dateEmission) : null},
			        ${f.dateEcheance ? toIsoDate(f.dateEcheance) : null}, ${f.total}, ${f.note}, ${f.referenceExterne},
			        ${key.dolibarrInvoiceId}, ${key.dolibarrSupplierInvoiceId})
			RETURNING id
		`;
		id = row.id;
		report.factures.created += 1;
	}
	await tx`DELETE FROM facture_lignes WHERE facture_id = ${id}`;
	for (const [i, raw] of lines.entries()) {
		const l = lineValues(raw);
		await tx`
			INSERT INTO facture_lignes (facture_id, ordre, libelle, quantite, prix_unitaire, total)
			VALUES (${id}, ${i + 1}, ${l.libelle}, ${l.quantite}, ${l.prixUnitaire}, ${l.total})
		`;
	}
}

async function importInvoice(tx: postgres.TransactionSql, inv: RawInvoice, tiersBySocId: Map<number, number>, report: ImportReport): Promise<void> {
	const statut = invoiceStatut(inv.statut ?? inv.status, inv.paye);
	if (!statut) return; // draft: never issued, nothing to archive
	const tiersId = tiersBySocId.get(num(inv.socid) ?? -1);
	if (!tiersId) {
		report.warnings.push(`Facture ${inv.ref} : tiers Dolibarr ${inv.socid} inconnu, ignorée.`);
		return;
	}
	await upsertFacture(
		tx,
		{ dolibarrInvoiceId: Number(inv.id), dolibarrSupplierInvoiceId: null },
		{
			sens: 'emise',
			// Dolibarr type 2 = avoir (credit note); everything else is imported as a plain invoice.
			type: num(inv.type) === 2 ? 'note_de_credit' : 'facture',
			tiersId,
			// Dolibarr's own number is kept as the number: it's what the customer received.
			numero: inv.ref,
			statut,
			dateEmission: calendarDay(inv.date),
			dateEcheance: calendarDay(inv.date_lim_reglement),
			total: num(inv.total_ttc) ?? 0,
			note: text(inv.note_public),
			referenceExterne: inv.ref
		},
		inv.lines ?? [],
		report
	);
}

async function importSupplierInvoice(tx: postgres.TransactionSql, inv: RawSupplierInvoice, tiersBySocId: Map<number, number>, report: ImportReport): Promise<void> {
	const statut = invoiceStatut(inv.statut ?? inv.status, inv.paye);
	if (!statut) return;
	const tiersId = tiersBySocId.get(num(inv.socid) ?? -1);
	if (!tiersId) {
		report.warnings.push(`Facture fournisseur ${inv.ref} : tiers Dolibarr ${inv.socid} inconnu, ignorée.`);
		return;
	}
	// Supplier references sometimes carry stray bidi marks from copy-pasting (seen on preprod).
	const refSupplier = text(inv.ref_supplier)?.replace(/[\u202a-\u202e\u2066-\u2069]/g, '').trim();
	await upsertFacture(
		tx,
		{ dolibarrInvoiceId: null, dolibarrSupplierInvoiceId: Number(inv.id) },
		{
			sens: 'recue',
			type: 'facture',
			tiersId,
			numero: refSupplier || inv.ref,
			statut,
			dateEmission: calendarDay(inv.date),
			dateEcheance: calendarDay(inv.date_echeance),
			total: num(inv.total_ttc) ?? 0,
			note: text(inv.label),
			referenceExterne: inv.ref
		},
		inv.lines ?? [],
		report
	);
	await tx`UPDATE tiers SET est_fournisseur = true WHERE id = ${tiersId} AND NOT est_fournisseur`;
}

async function archiveInvoicePdfs(invoices: RawInvoice[], supplierInvoices: RawSupplierInvoice[], report: ImportReport): Promise<number> {
	const sql = await getDb();
	const missing = await sql<{ id: number; dolibarr_invoice_id: number | null; dolibarr_supplier_invoice_id: number | null; reference_externe: string }[]>`
		SELECT id, dolibarr_invoice_id, dolibarr_supplier_invoice_id, reference_externe FROM factures
		WHERE pdf IS NULL AND (dolibarr_invoice_id IS NOT NULL OR dolibarr_supplier_invoice_id IS NOT NULL)
	`;
	const byInvoiceId = new Map(invoices.map((i) => [Number(i.id), i]));
	const bySupplierId = new Map(supplierInvoices.map((i) => [Number(i.id), i]));
	let archived = 0;
	for (const row of missing) {
		const raw = row.dolibarr_invoice_id !== null ? byInvoiceId.get(row.dolibarr_invoice_id) : bySupplierId.get(row.dolibarr_supplier_invoice_id ?? -1);
		if (!raw?.last_main_doc) continue; // Dolibarr never generated one — nothing to archive
		try {
			const doc = await downloadDolibarrDocument(row.dolibarr_invoice_id !== null ? 'facture' : 'facture_fournisseur', raw.last_main_doc);
			await attachPdf(row.id, Buffer.from(doc.content));
			archived += 1;
		} catch (err) {
			report.warnings.push(`${row.reference_externe} : PDF non récupéré (${(err as Error).message.slice(0, 120)}).`);
		}
	}
	return archived;
}

interface ImportContext {
	types: Set<number>;
	thirdPartyById: Map<number, RawThirdParty>;
	subscriptionsByMember: Map<number, RawSubscription[]>;
	claimedSocIds: Set<number>;
}

function memberLabel(m: RawMember): string {
	return [m.firstname, m.lastname].map(text).filter(Boolean).join(' ') || text(m.societe) || `adhérent ${m.id}`;
}

function thirdPartyValues(tp: RawThirdParty, report: ImportReport): TiersValues {
	// TE_PRIVATE is Dolibarr's "particulier" third-party type; everything else is an organisation.
	const isPerson = tp.typent_code === 'TE_PRIVATE';
	return {
		nature: isPerson ? 'personne_physique' : 'personne_morale',
		nom: tp.name.trim(),
		prenom: null,
		email: text(tp.email),
		telephone: text(tp.phone),
		adresse: text(tp.address),
		codePostal: text(tp.zip),
		ville: text(tp.town),
		pays: text(tp.country_code) ?? 'BE',
		numeroEntreprise: isPerson ? null : enterpriseNumber(tp),
		iban: iban(tp.array_options?.options_iban_pro, report.warnings, tp.name),
		exempteCotisation: false,
		// Dolibarr: client 0 = none, 1 = customer, 2 = prospect, 3 = both.
		estClient: (num(tp.client) ?? 0) === 1 || (num(tp.client) ?? 0) === 3,
		estFournisseur: num(tp.fournisseur) === 1,
		actif: (num(tp.status) ?? 1) === 1,
		dolibarrMemberId: null,
		dolibarrSocId: Number(tp.id)
	};
}

async function importMember(tx: postgres.TransactionSql, m: RawMember, ctx: ImportContext, report: ImportReport): Promise<void> {
	const memberId = Number(m.id);
	const socId = num(m.fk_soc) ?? num(m.socid);
	const thirdParty = socId !== null ? ctx.thirdPartyById.get(socId) : undefined;
	const typeId = num(m.typeid) ?? num(m.fk_adherent_type);
	const exempte = typeId !== null && ctx.types.has(typeId);
	// Dolibarr: -1 draft, 0 resigned, 1 validated. A resigned member's tiers stays, inactive.
	const actif = num(m.statut) !== 0;
	const label = memberLabel(m);
	if (socId !== null && !thirdParty) {
		report.warnings.push(`${label} : tiers Dolibarr ${socId} introuvable, adhérent importé seul.`);
	}
	if (socId !== null) ctx.claimedSocIds.add(socId);

	const common = {
		email: text(m.email) ?? text(thirdParty?.email) ?? null,
		telephone: text(m.phone_mobile) ?? text(m.phone) ?? text(m.phone_perso) ?? text(thirdParty?.phone) ?? null,
		adresse: text(m.address) ?? text(thirdParty?.address) ?? null,
		codePostal: text(m.zip) ?? text(thirdParty?.zip) ?? null,
		ville: text(m.town) ?? text(thirdParty?.town) ?? null,
		pays: text(m.country_code) ?? text(thirdParty?.country_code) ?? 'BE',
		exempteCotisation: exempte,
		estClient: thirdParty ? (num(thirdParty.client) ?? 0) === 1 || (num(thirdParty.client) ?? 0) === 3 : false,
		estFournisseur: thirdParty ? num(thirdParty.fournisseur) === 1 : false,
		actif,
		dolibarrMemberId: memberId,
		dolibarrSocId: socId
	};

	// The tiers whose cotisations these are: the person for a physical member (their billing third
	// party, if any, is the same person — Dolibarr needed one to invoice), the organisation for a
	// moral one.
	let payerId: number;
	let cotisationType: 'libre' | 'facturee';

	if (m.morphy === 'mor') {
		const nom = text(thirdParty?.name) ?? text(m.societe);
		if (!nom) {
			report.warnings.push(`Adhérent ${memberId} (moral) sans dénomination, ignoré.`);
			return;
		}
		payerId = await upsertTiers(
			tx,
			{
				...common,
				nature: 'personne_morale',
				nom,
				prenom: null,
				numeroEntreprise: thirdParty ? enterpriseNumber(thirdParty) : null,
				iban: iban(thirdParty?.array_options?.options_iban_pro, report.warnings, nom)
			},
			report
		);
		cotisationType = 'facturee';

		// The person named on the member card becomes the organisation's contact and administrator,
		// covered by its cotisation — the model's "société adhérente" case.
		const prenom = text(m.firstname);
		const lastname = text(m.lastname);
		if (lastname || prenom) {
			const contactId = await upsertContactPerson(
				tx,
				payerId,
				{ nom: lastname ?? prenom ?? '?', prenom: lastname ? prenom : null, email: text(m.email) },
				report
			);
			const firstSub = (ctx.subscriptionsByMember.get(memberId) ?? [])
				.map((s) => calendarDay(s.dateh))
				.filter((d): d is Date => d !== null)
				.sort((a, b) => a.getTime() - b.getTime())[0];
			await upsertLien(tx, payerId, contactId, firstSub ?? calendarDay(m.datec) ?? brusselsToday(), report);
		}
	} else {
		const lastname = text(m.lastname);
		const prenom = text(m.firstname);
		if (!lastname && !prenom) {
			report.warnings.push(`Adhérent ${memberId} (physique) sans nom, ignoré.`);
			return;
		}
		payerId = await upsertTiers(
			tx,
			{
				...common,
				nature: 'personne_physique',
				nom: lastname ?? prenom ?? '?',
				prenom: lastname ? prenom : null,
				numeroEntreprise: thirdParty ? enterpriseNumber(thirdParty) : null,
				iban:
					iban(m.array_options?.options_iban_perso, report.warnings, label) ??
					iban(thirdParty?.array_options?.options_iban_pro, report.warnings, label)
			},
			report
		);
		cotisationType = 'libre';
	}

	for (const s of ctx.subscriptionsByMember.get(memberId) ?? []) {
		const subId = num(s.rowid) ?? num(s.id);
		const debut = calendarDay(s.dateh);
		const datef = calendarDay(s.datef);
		if (subId === null || !debut || !datef) {
			report.warnings.push(`${label} : souscription ${subId ?? '?'} sans dates complètes, ignorée.`);
			continue;
		}
		// Dolibarr's datef is the last covered day; the compta `fin` is exclusive.
		const fin = addUTCDays(datef, 1);
		if (fin.getTime() <= debut.getTime()) {
			report.warnings.push(`${label} : souscription ${subId} avec fin avant début, ignorée.`);
			continue;
		}
		await upsertCotisation(tx, {
			tiersId: payerId,
			type: cotisationType,
			debut,
			fin,
			montant: num(s.amount) ?? 0,
			note: text(s.note_public) ?? text(s.note),
			dolibarrSubscriptionId: subId
		}, report);
	}
}

async function upsertTiers(tx: postgres.TransactionSql, v: TiersValues, report: ImportReport): Promise<number> {
	const [existing] = await tx<{ id: number }[]>`
		SELECT id FROM tiers
		WHERE (${v.dolibarrMemberId}::int IS NOT NULL AND dolibarr_member_id = ${v.dolibarrMemberId})
		   OR (${v.dolibarrSocId}::int IS NOT NULL AND dolibarr_soc_id = ${v.dolibarrSocId})
		ORDER BY dolibarr_member_id IS NULL
		LIMIT 1
	`;
	if (existing) {
		await tx`
			UPDATE tiers SET
				nature = ${v.nature}, nom = ${v.nom}, prenom = ${v.prenom}, email = ${v.email}, telephone = ${v.telephone},
				adresse = ${v.adresse}, code_postal = ${v.codePostal}, ville = ${v.ville}, pays = ${v.pays},
				numero_entreprise = ${v.numeroEntreprise}, iban = COALESCE(${v.iban}, iban),
				exempte_cotisation = ${v.exempteCotisation}, est_client = ${v.estClient}, est_fournisseur = ${v.estFournisseur},
				actif = ${v.actif}, dolibarr_member_id = COALESCE(dolibarr_member_id, ${v.dolibarrMemberId}),
				dolibarr_soc_id = COALESCE(dolibarr_soc_id, ${v.dolibarrSocId}), updated_at = now()
			WHERE id = ${existing.id}
		`;
		report.tiers.updated += 1;
		return existing.id;
	}
	const [row] = await tx<{ id: number }[]>`
		INSERT INTO tiers (
			nature, nom, prenom, email, telephone, adresse, code_postal, ville, pays, numero_entreprise, iban,
			exempte_cotisation, est_client, est_fournisseur, actif, dolibarr_member_id, dolibarr_soc_id
		) VALUES (
			${v.nature}, ${v.nom}, ${v.prenom}, ${v.email}, ${v.telephone}, ${v.adresse}, ${v.codePostal}, ${v.ville},
			${v.pays}, ${v.numeroEntreprise}, ${v.iban}, ${v.exempteCotisation}, ${v.estClient}, ${v.estFournisseur},
			${v.actif}, ${v.dolibarrMemberId}, ${v.dolibarrSocId}
		)
		RETURNING id
	`;
	report.tiers.created += 1;
	return row.id;
}

// A contact named on a moral member's card has no Dolibarr id of its own. A re-run finds the person
// it created last time through the link to the organisation (by name), so an email or address the
// treasury corrected since doesn't make the import create a duplicate; failing that, by name + email.
async function upsertContactPerson(
	tx: postgres.TransactionSql,
	organisationId: number,
	p: { nom: string; prenom: string | null; email: string | null },
	report: ImportReport
): Promise<number> {
	const [linked] = await tx<{ id: number }[]>`
		SELECT t.id FROM tiers t
		JOIN tiers_liens l ON l.personne_id = t.id AND l.organisation_id = ${organisationId}
		WHERE t.nature = 'personne_physique'
		  AND lower(t.nom) = lower(${p.nom})
		  AND lower(coalesce(t.prenom, '')) = lower(${p.prenom ?? ''})
		LIMIT 1
	`;
	if (linked) return linked.id;
	const [existing] = await tx<{ id: number }[]>`
		SELECT id FROM tiers
		WHERE nature = 'personne_physique'
		  AND lower(nom) = lower(${p.nom})
		  AND lower(coalesce(prenom, '')) = lower(${p.prenom ?? ''})
		  AND lower(coalesce(email, '')) = lower(${p.email ?? ''})
		LIMIT 1
	`;
	if (existing) return existing.id;
	const [row] = await tx<{ id: number }[]>`
		INSERT INTO tiers (nature, nom, prenom, email) VALUES ('personne_physique', ${p.nom}, ${p.prenom}, ${p.email})
		RETURNING id
	`;
	report.tiers.created += 1;
	return row.id;
}

async function upsertLien(tx: postgres.TransactionSql, organisationId: number, personneId: number, depuis: Date, report: ImportReport): Promise<void> {
	const [existing] = await tx<{ id: number }[]>`
		SELECT id FROM tiers_liens WHERE organisation_id = ${organisationId} AND personne_id = ${personneId}
	`;
	if (existing) {
		// Roles may have been refined by hand since — only the start date is Dolibarr's to say.
		await tx`UPDATE tiers_liens SET depuis = LEAST(depuis, ${toIsoDate(depuis)}::date) WHERE id = ${existing.id}`;
		report.liens.updated += 1;
		return;
	}
	await tx`
		INSERT INTO tiers_liens (organisation_id, personne_id, est_administrateur, est_contact, destinataire_factures, herite_adhesion, depuis)
		VALUES (${organisationId}, ${personneId}, true, true, true, true, ${toIsoDate(depuis)})
	`;
	report.liens.created += 1;
}

async function upsertCotisation(
	tx: postgres.TransactionSql,
	c: { tiersId: number; type: 'libre' | 'facturee'; debut: Date; fin: Date; montant: number; note: string | null; dolibarrSubscriptionId: number },
	report: ImportReport
): Promise<void> {
	const [existing] = await tx<{ id: number }[]>`
		SELECT id FROM cotisations WHERE dolibarr_subscription_id = ${c.dolibarrSubscriptionId}
	`;
	if (existing) {
		await tx`
			UPDATE cotisations SET tiers_id = ${c.tiersId}, type = ${c.type}, debut = ${toIsoDate(c.debut)}, fin = ${toIsoDate(c.fin)},
				montant = ${c.montant}, note = COALESCE(note, ${c.note})
			WHERE id = ${existing.id}
		`;
		report.cotisations.updated += 1;
		return;
	}
	// A Dolibarr subscription is a received payment: active, paid on its start day for lack of
	// better information.
	await tx`
		INSERT INTO cotisations (tiers_id, type, debut, fin, montant, sieges, statut, paye_le, note, dolibarr_subscription_id)
		VALUES (${c.tiersId}, ${c.type}, ${toIsoDate(c.debut)}, ${toIsoDate(c.fin)}, ${c.montant}, 1, 'active',
		        ${toIsoDate(c.debut)}, ${c.note}, ${c.dolibarrSubscriptionId})
	`;
	report.cotisations.created += 1;
}

// Email is all Dolibarr knows; from here on authentik_pk is the key (see resolveTiersForUser).
async function linkAuthentikAccounts(tx: postgres.TransactionSql, pkByEmail: Map<string, number>, report: ImportReport): Promise<number> {
	const unlinked = await tx<{ id: number; nom: string; prenom: string | null; email: string }[]>`
		SELECT id, nom, prenom, email FROM tiers
		WHERE nature = 'personne_physique' AND authentik_pk IS NULL AND email IS NOT NULL
	`;
	let linked = 0;
	for (const t of unlinked) {
		const pk = pkByEmail.get(t.email.toLowerCase());
		const who = [t.prenom, t.nom].filter(Boolean).join(' ');
		if (pk === undefined) {
			report.warnings.push(`${who} : aucun compte Authentik pour ${t.email}.`);
			continue;
		}
		const [taken] = await tx<{ id: number }[]>`SELECT id FROM tiers WHERE authentik_pk = ${pk}`;
		if (taken) {
			report.warnings.push(`${who} : le compte Authentik de ${t.email} est déjà lié au tiers ${taken.id}.`);
			continue;
		}
		await tx`UPDATE tiers SET authentik_pk = ${pk}, updated_at = now() WHERE id = ${t.id}`;
		linked += 1;
	}
	return linked;
}
