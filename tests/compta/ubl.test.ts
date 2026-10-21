import { describe, expect, it } from 'vitest';
import type { Facture } from '$lib/server/compta/factures';
import type { ComptaSettings } from '$lib/server/compta/settings';
import type { Tiers } from '$lib/server/compta/tiers';
import { parseUbl, renderUbl, UblError } from '$lib/server/compta/ubl';

const settings: ComptaSettings = {
	delaiGraceJours: 90,
	emetteurNom: 'Liège Hackerspace ASBL',
	emetteurAdresse: 'Rue de l’Exemple 1, 4000 Liège',
	emetteurNumeroEntreprise: '0123.456.789',
	emetteurEmail: 'compta@exemple.test',
	emetteurIban: 'BE71 0961 2345 6769',
	mentionTva: 'Franchise TVA (art. 56bis CTVA)',
	delaiPaiementJours: 30,
	desactivationAuto: false,
	receptionDomaines: '',
	receptionAuto: false,
	rappelDelaiJours: 14
};

const client: Tiers = {
	id: 3,
	createdAt: new Date(),
	nature: 'personne_morale',
	nom: 'Dupont & Fils <SRL>',
	prenom: null,
	email: 'factures@dupont.test',
	telephone: null,
	adresse: 'Rue "Haute" 2',
	codePostal: '4000',
	ville: 'Liège',
	pays: 'BE',
	numeroEntreprise: 'BE 0987.654.321',
	iban: null,
	authentikPk: null,
	exempteCotisation: false,
	estClient: true,
	estFournisseur: false,
	actif: true,
	notes: null,
	dolibarrMemberId: null,
	dolibarrSocId: null
};

function facture(extra: Partial<Facture> = {}): Facture {
	return {
		id: 7,
		createdAt: new Date(),
		sens: 'emise',
		type: 'facture',
		tiersId: client.id,
		tiers: { id: client.id, nom: client.nom, nature: client.nature },
		numero: '2026-0007',
		statut: 'validee',
		dateEmission: new Date(Date.UTC(2026, 8, 1)),
		dateEcheance: new Date(Date.UTC(2026, 9, 1)),
		total: 150,
		objet: 'Sponsoring 2026',
		note: null,
		communicationStructuree: '+++202/6000/00796+++',
		factureOrigineId: null,
		factureOrigineNumero: null,
		referenceExterne: null,
		hasPdf: false,
		hasUbl: false,
		payeeLe: null,
		envoyeeLe: null,
		envoyeeA: null,
		cotisation: null,
		cotisationId: null,
		rubrique: null,
		lettre: 0,
		lignes: [
			{ id: 1, ordre: 1, libelle: 'Sponsoring « Bronze »', quantite: 1, prixUnitaire: 100, total: 100 },
			{ id: 2, ordre: 2, libelle: 'Stand < 2 m²', quantite: 2, prixUnitaire: 25, total: 50 }
		],
		...extra
	};
}

// A supplier's invoice as their platform would send it: amounts net of VAT on the lines, the
// gross total as what's payable.
function supplierUbl(lines: { name: string; qty: number; net: number }[], payable: number, credit = false): string {
	const doc = credit ? 'CreditNote' : 'Invoice';
	const lineTag = credit ? 'CreditNoteLine' : 'InvoiceLine';
	const qtyTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
	return `<?xml version="1.0" encoding="UTF-8"?>
<${doc} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${doc}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-2026-118</cbc:ID>
  <cbc:IssueDate>2026-09-03</cbc:IssueDate>
  <cbc:DueDate>2026-10-03</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Fournil</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Quai 3</cbc:StreetName><cbc:CityName>Namur</cbc:CityName><cbc:PostalZone>5000</cbc:PostalZone><cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>BE0111222333</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Fournil SRL</cbc:RegistrationName><cbc:CompanyID>0111222333</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">${payable.toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
  ${lines
		.map(
			(l) =>
				`<cac:${lineTag}><cbc:${qtyTag}>${l.qty}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="EUR">${l.net.toFixed(2)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${l.name}</cbc:Name></cac:Item></cac:${lineTag}>`
		)
		.join('\n  ')}
</${doc}>`;
}

const sumLines = (lignes: { quantite: number; prixUnitaire: number }[]) =>
	lignes.reduce((acc, l) => acc + Math.round(l.quantite * l.prixUnitaire * 100), 0) / 100;

describe('renderUbl', () => {
	it('escapes names and addresses, so the document stays well-formed', () => {
		const xml = renderUbl(facture(), client, settings);
		expect(xml).toContain('Dupont &amp; Fils &lt;SRL&gt;');
		expect(xml).toContain('Rue &quot;Haute&quot; 2');
		expect(xml).toContain('Stand &lt; 2 m²');
		expect(xml).not.toMatch(/<SRL>/);
	});

	it('addresses the customer by enterprise number (scheme 0208), digits only', () => {
		expect(renderUbl(facture(), client, settings)).toContain('<cbc:EndpointID schemeID="0208">0987654321</cbc:EndpointID>');
	});

	it('falls back to email (scheme EM) for a customer with no enterprise number', () => {
		const xml = renderUbl(facture(), { ...client, numeroEntreprise: null }, settings);
		expect(xml).toContain('<cbc:EndpointID schemeID="EM">factures@dupont.test</cbc:EndpointID>');
	});

	it('reads back what it wrote: number, dates, total and lines', () => {
		const lu = parseUbl(renderUbl(facture(), client, settings));
		expect(lu).toMatchObject({ type: 'facture', numero: '2026-0007', dateEmission: '2026-09-01', dateEcheance: '2026-10-01', total: 150 });
		expect(lu.lignes).toEqual([
			{ libelle: 'Sponsoring « Bronze »', quantite: 1, prixUnitaire: 100 },
			{ libelle: 'Stand < 2 m²', quantite: 2, prixUnitaire: 25 }
		]);
	});
});

describe('parseUbl', () => {
	it('reads a supplier invoice and scales net lines up to the payable total', () => {
		const lu = parseUbl(supplierUbl([{ name: 'Pain', qty: 1, net: 100 }], 121));
		expect(lu).toMatchObject({ type: 'facture', numero: 'F-2026-118', dateEmission: '2026-09-03', dateEcheance: '2026-10-03', total: 121 });
		expect(lu.fournisseur).toMatchObject({ nom: 'Fournil SRL', numeroEntreprise: '0111222333', tva: 'BE0111222333', ville: 'Namur' });
		expect(lu.lignes).toEqual([{ libelle: 'Pain', quantite: 1, prixUnitaire: 121 }]);
	});

	// The recorded invoice's total is the sum of its lines: if rounding a unit price loses a cent,
	// the supplier's real payment no longer fits what we think we owe and can't be allocated.
	it('keeps the lines adding up to exactly what is payable, cent for cent', () => {
		const cases = [
			{ lines: [{ name: 'Café', qty: 3, net: 10 }], payable: 12.1 },
			{ lines: [{ name: 'A', qty: 1, net: 1 }, { name: 'B', qty: 1, net: 1 }, { name: 'C', qty: 1, net: 1 }], payable: 1 },
			{ lines: [{ name: 'Vis', qty: 7, net: 3.33 }, { name: 'Écrous', qty: 12, net: 5.01 }], payable: 10.09 }
		];
		for (const { lines, payable } of cases) {
			const lu = parseUbl(supplierUbl(lines, payable));
			expect(sumLines(lu.lignes)).toBe(payable);
			expect(lu.lignes).toHaveLength(lines.length);
		}
	});

	it('names the quantity in the label when the unit price cannot be kept to the cent', () => {
		const lu = parseUbl(supplierUbl([{ name: 'Café', qty: 3, net: 10 }], 12.1));
		expect(lu.lignes).toEqual([{ libelle: '3 × Café', quantite: 1, prixUnitaire: 12.1 }]);
	});

	it('keeps a discount line negative', () => {
		const lu = parseUbl(supplierUbl([{ name: 'Abonnement', qty: 1, net: 100 }, { name: 'Remise', qty: 1, net: -10 }], 108.9));
		expect(lu.lignes).toEqual([
			{ libelle: 'Abonnement', quantite: 1, prixUnitaire: 121 },
			{ libelle: 'Remise', quantite: 1, prixUnitaire: -12.1 }
		]);
	});

	it('reads a credit note with negative amounts that still add up', () => {
		const lu = parseUbl(supplierUbl([{ name: 'Retour', qty: 3, net: 10 }], 12.1, true));
		expect(lu.type).toBe('note_de_credit');
		expect(lu.total).toBe(-12.1);
		expect(sumLines(lu.lignes)).toBe(-12.1);
	});

	it('refuses what is not a UBL invoice', () => {
		expect(() => parseUbl('<html></html>')).toThrow(UblError);
		expect(() => parseUbl('pas du xml <')).toThrow(UblError);
	});
});
