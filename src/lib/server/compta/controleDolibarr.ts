import { getDb } from '$lib/server/db';
import type { CotisationStatus } from '$lib/types';
import { listSituations } from './cotisations';
import { addUTCDays, brusselsToday, parseMoney, toIsoDate } from './dates';
import type { FactureStatut } from './factures';
import { calendarDay, chargerDolibarr, invoiceStatut, num, type DonneesDolibarr, type RawInvoice, type RawSupplierInvoice } from './importDolibarr';

// Control report for the switch from Dolibarr: once the import is applied, Dolibarr and Passport
// are compared figure by figure — tiers, invoices, cotisations, bank balances, and who is in order
// today — so the treasury can sign off the migration on numbers rather than on trust. Meant to be
// run right after the import, before anything is entered in Passport: an invoice paid in Passport
// since then rightly differs from Dolibarr.
//
// `comparer` is pure (both sides already loaded) and is what the tests exercise; `controlerImport`
// loads both sides.

export interface DonneesPassport {
	// By Dolibarr member id: the tiers' name and today's status.
	membres: Map<number, { nom: string; status: CotisationStatus }>;
	// Dolibarr third-party ids found on a tiers.
	socs: Set<number>;
	facturesEmises: Map<number, { statut: FactureStatut; total: number }>;
	facturesRecues: Map<number, { statut: FactureStatut; total: number }>;
	// By Dolibarr subscription id; dates ISO, `fin` exclusive.
	cotisations: Map<number, { montant: number; debut: string; fin: string }>;
	// By Dolibarr bank account id: opening balance plus every movement.
	comptes: Map<number, { nom: string; solde: number }>;
}

export interface LigneControle {
	domaine: string;
	dolibarr: string;
	passport: string;
	ok: boolean;
}

export interface RapportControle {
	lignes: LigneControle[];
	// What doesn't match, one line each, for the treasurer to check by hand.
	ecarts: { domaine: string; detail: string }[];
}

const euros = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
const cents = (n: number) => Math.round(n * 100);
const memeMontant = (a: number, b: number) => cents(a) === cents(b);

// The statuses that open the door, on both sides. Passport's grace period has no Dolibarr
// equivalent, so a member in grace counts as not in order — as Dolibarr sees them too.
const EN_ORDRE: CotisationStatus[] = ['a_jour', 'non_applicable'];

function membreLabel(m: DonneesDolibarr['members'][number]): string {
	return [m.firstname, m.lastname].map((s) => s?.trim()).filter(Boolean).join(' ') || m.societe?.trim() || `adhérent ${m.id}`;
}

function comparerFactures(
	domaine: string,
	dolibarr: (RawInvoice | RawSupplierInvoice)[],
	passport: Map<number, { statut: FactureStatut; total: number }>,
	rapport: RapportControle
): void {
	let attendues = 0;
	let sommeDolibarr = 0;
	let trouvees = 0;
	let sommePassport = 0;
	for (const inv of dolibarr) {
		const statut = invoiceStatut(inv.statut ?? inv.status, inv.paye);
		if (!statut) continue; // a draft was never issued and is not imported
		const total = num(inv.total_ttc) ?? 0;
		attendues += 1;
		sommeDolibarr += total;
		const p = passport.get(Number(inv.id));
		if (!p) {
			rapport.ecarts.push({ domaine, detail: `${inv.ref} (${euros.format(total)}) absente de Passport.` });
			continue;
		}
		trouvees += 1;
		sommePassport += p.total;
		if (p.statut !== statut) rapport.ecarts.push({ domaine, detail: `${inv.ref} : ${statut} dans Dolibarr, ${p.statut} dans Passport.` });
		if (!memeMontant(p.total, total)) rapport.ecarts.push({ domaine, detail: `${inv.ref} : ${euros.format(total)} dans Dolibarr, ${euros.format(p.total)} dans Passport.` });
	}
	rapport.lignes.push({
		domaine,
		dolibarr: `${attendues} · ${euros.format(sommeDolibarr)}`,
		passport: `${trouvees} · ${euros.format(sommePassport)}`,
		ok: attendues === trouvees && memeMontant(sommeDolibarr, sommePassport)
	});
}

export function comparer(d: DonneesDolibarr, p: DonneesPassport, today: Date): RapportControle {
	const rapport: RapportControle = { lignes: [], ecarts: [] };

	// Every member and every third party has its tiers.
	const membresTrouves = d.members.filter((m) => p.membres.has(Number(m.id)));
	for (const m of d.members) {
		if (!p.membres.has(Number(m.id))) rapport.ecarts.push({ domaine: 'Adhérents', detail: `${membreLabel(m)} (adhérent ${m.id}) absent de Passport.` });
	}
	rapport.lignes.push({ domaine: 'Adhérents', dolibarr: String(d.members.length), passport: String(membresTrouves.length), ok: membresTrouves.length === d.members.length });

	const socsTrouves = d.thirdParties.filter((tp) => p.socs.has(Number(tp.id)));
	for (const tp of d.thirdParties) {
		if (!p.socs.has(Number(tp.id))) rapport.ecarts.push({ domaine: 'Tiers', detail: `${tp.name} (tiers ${tp.id}) absent de Passport.` });
	}
	rapport.lignes.push({ domaine: 'Tiers', dolibarr: String(d.thirdParties.length), passport: String(socsTrouves.length), ok: socsTrouves.length === d.thirdParties.length });

	comparerFactures('Factures émises', d.invoices, p.facturesEmises, rapport);
	comparerFactures('Factures reçues', d.supplierInvoices, p.facturesRecues, rapport);

	// Cotisations: the subscriptions the import keeps (complete dates, end after start).
	let attendues = 0;
	let trouvees = 0;
	let sommeDolibarr = 0;
	let sommePassport = 0;
	for (const m of d.members) {
		for (const s of d.subscriptionsByMember.get(Number(m.id)) ?? []) {
			const id = num(s.rowid) ?? num(s.id);
			const debut = calendarDay(s.dateh);
			const datef = calendarDay(s.datef);
			if (id === null || !debut || !datef || addUTCDays(datef, 1).getTime() <= debut.getTime()) continue;
			const montant = num(s.amount) ?? 0;
			attendues += 1;
			sommeDolibarr += montant;
			const c = p.cotisations.get(id);
			if (!c) {
				rapport.ecarts.push({ domaine: 'Cotisations', detail: `${membreLabel(m)} : souscription ${id} du ${toIsoDate(debut)} absente de Passport.` });
				continue;
			}
			trouvees += 1;
			sommePassport += c.montant;
			if (!memeMontant(c.montant, montant)) {
				rapport.ecarts.push({ domaine: 'Cotisations', detail: `${membreLabel(m)} : souscription ${id} à ${euros.format(montant)} dans Dolibarr, ${euros.format(c.montant)} dans Passport.` });
			}
			if (c.debut !== toIsoDate(debut) || c.fin !== toIsoDate(addUTCDays(datef, 1))) {
				rapport.ecarts.push({ domaine: 'Cotisations', detail: `${membreLabel(m)} : souscription ${id} sur d’autres dates dans Passport.` });
			}
		}
	}
	rapport.lignes.push({
		domaine: 'Cotisations',
		dolibarr: `${attendues} · ${euros.format(sommeDolibarr)}`,
		passport: `${trouvees} · ${euros.format(sommePassport)}`,
		ok: attendues === trouvees && memeMontant(sommeDolibarr, sommePassport)
	});

	// Each account's balance: in Dolibarr the sum of all its lines, the opening one included.
	for (const b of d.bankAccounts) {
		const soldeDolibarr = (d.bankLinesByAccount.get(Number(b.id)) ?? []).reduce((a, l) => a + (num(l.amount) ?? 0), 0);
		const c = p.comptes.get(Number(b.id));
		const domaine = `Solde ${b.label.trim()}`;
		if (!c) rapport.ecarts.push({ domaine, detail: `Compte ${b.label.trim()} absent de Passport.` });
		else if (!memeMontant(c.solde, soldeDolibarr)) rapport.ecarts.push({ domaine, detail: `Écart de ${euros.format(c.solde - soldeDolibarr)}.` });
		rapport.lignes.push({ domaine, dolibarr: euros.format(soldeDolibarr), passport: c ? euros.format(c.solde) : '—', ok: !!c && memeMontant(c.solde, soldeDolibarr) });
	}

	// Who is in order today — what decides whose badge opens the door after the switch. In
	// Dolibarr: a validated member of an exempt type, or one whose last subscription runs today.
	const exempts = new Set(d.types.filter((t) => !t.subscriptionRequired).map((t) => t.id));
	let enOrdreDolibarr = 0;
	let enOrdrePassport = 0;
	for (const m of d.members) {
		const typeId = num(m.typeid) ?? num(m.fk_adherent_type);
		const derniere = (d.subscriptionsByMember.get(Number(m.id)) ?? [])
			.map((s) => calendarDay(s.datef))
			.filter((x): x is Date => x !== null)
			.reduce<Date | null>((a, x) => (!a || x > a ? x : a), null);
		const dolibarr = num(m.statut) === 1 && ((typeId !== null && exempts.has(typeId)) || (!!derniere && derniere.getTime() >= today.getTime()));
		const pm = p.membres.get(Number(m.id));
		const passport = !!pm && EN_ORDRE.includes(pm.status);
		if (dolibarr) enOrdreDolibarr += 1;
		if (passport) enOrdrePassport += 1;
		if (pm && dolibarr !== passport) {
			rapport.ecarts.push({
				domaine: 'En ordre aujourd’hui',
				detail: `${membreLabel(m)} : ${dolibarr ? 'en ordre' : 'pas en ordre'} dans Dolibarr, ${pm.status.replace('_', ' ')} dans Passport.`
			});
		}
	}
	rapport.lignes.push({
		domaine: 'En ordre aujourd’hui',
		dolibarr: String(enOrdreDolibarr),
		passport: String(enOrdrePassport),
		ok: !rapport.ecarts.some((e) => e.domaine === 'En ordre aujourd’hui') && enOrdreDolibarr === enOrdrePassport
	});

	return rapport;
}

export async function chargerPassport(today: Date): Promise<DonneesPassport> {
	const sql = await getDb();
	const [situations, factures, cotisations, comptes] = await Promise.all([
		listSituations(today),
		sql<{ dolibarr_invoice_id: number | null; dolibarr_supplier_invoice_id: number | null; statut: FactureStatut; total: string }[]>`
			SELECT dolibarr_invoice_id, dolibarr_supplier_invoice_id, statut, total FROM factures
			WHERE dolibarr_invoice_id IS NOT NULL OR dolibarr_supplier_invoice_id IS NOT NULL
		`,
		sql<{ dolibarr_subscription_id: number; montant: string; debut: string; fin: string }[]>`
			SELECT dolibarr_subscription_id, montant, debut::text AS debut, fin::text AS fin FROM cotisations
			WHERE dolibarr_subscription_id IS NOT NULL
		`,
		sql<{ dolibarr_bank_id: number; nom: string; solde: string }[]>`
			SELECT c.dolibarr_bank_id, c.nom, c.solde_ouverture + COALESCE((SELECT sum(m.montant) FROM mouvements m WHERE m.compte_id = c.id), 0) AS solde
			FROM comptes c WHERE c.dolibarr_bank_id IS NOT NULL
		`
	]);
	const membres = new Map<number, { nom: string; status: CotisationStatus }>();
	const socs = new Set<number>();
	for (const { tiers, situation } of situations) {
		if (tiers.dolibarrMemberId !== null) membres.set(tiers.dolibarrMemberId, { nom: tiers.nom, status: situation.status });
		if (tiers.dolibarrSocId !== null) socs.add(tiers.dolibarrSocId);
	}
	const facturesEmises = new Map<number, { statut: FactureStatut; total: number }>();
	const facturesRecues = new Map<number, { statut: FactureStatut; total: number }>();
	for (const f of factures) {
		const v = { statut: f.statut, total: parseMoney(f.total) };
		if (f.dolibarr_invoice_id !== null) facturesEmises.set(f.dolibarr_invoice_id, v);
		if (f.dolibarr_supplier_invoice_id !== null) facturesRecues.set(f.dolibarr_supplier_invoice_id, v);
	}
	return {
		membres,
		socs,
		facturesEmises,
		facturesRecues,
		cotisations: new Map(cotisations.map((c) => [c.dolibarr_subscription_id, { montant: parseMoney(c.montant), debut: c.debut, fin: c.fin }])),
		comptes: new Map(comptes.map((c) => [c.dolibarr_bank_id, { nom: c.nom, solde: parseMoney(c.solde) }]))
	};
}

export async function controlerImport(today: Date = brusselsToday()): Promise<RapportControle> {
	const [dolibarr, passport] = await Promise.all([chargerDolibarr(), chargerPassport(today)]);
	return comparer(dolibarr, passport, today);
}
