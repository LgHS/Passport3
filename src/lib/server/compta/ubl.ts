import { XMLParser } from 'fast-xml-parser';
import { normalizeIban } from '$lib/server/bankValidation';
import { toIsoDate } from './dates';
import type { Facture } from './factures';
import type { ComptaSettings } from './settings';
import type { Tiers } from './tiers';
import { tiersDisplayName } from './tiers';

// UBL 2.1 documents, Peppol BIS Billing 3.0 profile — docs/compta.md, "Factures".
//
// Out: one Invoice (or CreditNote) per issued document, generated at validation next to the PDF and
// stored in the row, for the treasurer to drop on Doccle. No VAT is charged (franchise regime):
// every line and the tax total use category E (exempt) with the wording from compta_settings as
// the exemption reason. The VATEX reason code is deliberately left out until the accountant
// confirms which one applies to art. 56bis — the free-text reason is enough for the schema and
// for the customer's platform to read the document.
//
// In: a supplier's UBL invoice, read into the fields a received invoice needs. Lenient on purpose:
// only what the form would otherwise ask for is extracted, anything else is ignored.

const NS = {
	inv: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
	cn: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
	cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
	cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
};

function esc(value: string | number | null | undefined): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function money(n: number): string {
	return Math.abs(n).toFixed(2);
}

// Belgian enterprise number as Peppol wants it: 10 digits, no dots — scheme 0208.
function bce(raw: string | null): string | null {
	const digits = (raw ?? '').replace(/\D/g, '');
	return digits.length === 10 ? digits : null;
}

function party(p: {
	nom: string;
	adresse: string | null;
	codePostal: string | null;
	ville: string | null;
	pays: string;
	numeroEntreprise: string | null;
	email: string | null;
}): string {
	const id = bce(p.numeroEntreprise);
	// Peppol requires an electronic address on both parties. The enterprise number (0208) when we
	// have it; a person or a foreign organisation without one is reached by email (EM).
	const endpoint = id
		? `<cbc:EndpointID schemeID="0208">${id}</cbc:EndpointID>`
		: p.email
			? `<cbc:EndpointID schemeID="EM">${esc(p.email)}</cbc:EndpointID>`
			: '';
	return `<cac:Party>
      ${endpoint}
      <cac:PartyName><cbc:Name>${esc(p.nom)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        ${p.adresse ? `<cbc:StreetName>${esc(p.adresse)}</cbc:StreetName>` : ''}
        ${p.ville ? `<cbc:CityName>${esc(p.ville)}</cbc:CityName>` : ''}
        ${p.codePostal ? `<cbc:PostalZone>${esc(p.codePostal)}</cbc:PostalZone>` : ''}
        <cac:Country><cbc:IdentificationCode>${esc(p.pays || 'BE')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(p.nom)}</cbc:RegistrationName>
        ${id ? `<cbc:CompanyID schemeID="0208">${id}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
      ${p.email ? `<cac:Contact><cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail></cac:Contact>` : ''}
    </cac:Party>`;
}

export function renderUbl(facture: Facture, tiers: Tiers, settings: ComptaSettings): string {
	const credit = facture.type === 'note_de_credit';
	const root = credit ? 'CreditNote' : 'Invoice';
	const lineTag = credit ? 'CreditNoteLine' : 'InvoiceLine';
	const qtyTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
	const total = money(facture.total);
	const [street, ...rest] = settings.emetteurAdresse.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	const cityLine = rest.join(' ');
	const postal = /^(\d{4})\s+(.+)$/.exec(cityLine);

	const lines = facture.lignes
		.map(
			(l) => `  <cac:${lineTag}>
    <cbc:ID>${l.ordre}</cbc:ID>
    <cbc:${qtyTag} unitCode="C62">${l.quantite}</cbc:${qtyTag}>
    <cbc:LineExtensionAmount currencyID="EUR">${money(l.total)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.libelle)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>E</cbc:ID>
        <cbc:Percent>0</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${money(l.prixUnitaire)}</cbc:PriceAmount></cac:Price>
  </cac:${lineTag}>`
		)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${credit ? NS.cn : NS.inv}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(facture.numero)}</cbc:ID>
  <cbc:IssueDate>${facture.dateEmission ? toIsoDate(facture.dateEmission) : ''}</cbc:IssueDate>
  ${!credit && facture.dateEcheance ? `<cbc:DueDate>${toIsoDate(facture.dateEcheance)}</cbc:DueDate>` : ''}
  <cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${credit ? 381 : 380}</cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  <cbc:Note>${esc(settings.mentionTva)}</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(facture.objet ?? tiersDisplayName(tiers))}</cbc:BuyerReference>
  ${credit && facture.factureOrigineNumero ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(facture.factureOrigineNumero)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  <cac:AccountingSupplierParty>
    ${party({
			nom: settings.emetteurNom,
			adresse: street ?? null,
			codePostal: postal?.[1] ?? null,
			ville: postal?.[2] ?? cityLine ?? null,
			pays: 'BE',
			numeroEntreprise: settings.emetteurNumeroEntreprise,
			email: settings.emetteurEmail
		})}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${party({
			nom: tiersDisplayName(tiers),
			adresse: tiers.adresse,
			codePostal: tiers.codePostal,
			ville: tiers.ville,
			pays: tiers.pays,
			numeroEntreprise: tiers.numeroEntreprise,
			email: tiers.email
		})}
  </cac:AccountingCustomerParty>
  ${
		!credit
			? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    ${facture.communicationStructuree ? `<cbc:PaymentID>${esc(facture.communicationStructuree)}</cbc:PaymentID>` : ''}
    <cac:PayeeFinancialAccount><cbc:ID>${esc(normalizeIban(settings.emetteurIban))}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
			: ''
	}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${total}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>E</cbc:ID>
        <cbc:Percent>0</cbc:Percent>
        <cbc:TaxExemptionReason>${esc(settings.mentionTva)}</cbc:TaxExemptionReason>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${total}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${total}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</${root}>
`;
}

// ---------------------------------------------------------------------------------------------
// Reading a supplier's UBL

export interface UblFournisseur {
	nom: string;
	numeroEntreprise: string | null;
	tva: string | null;
	email: string | null;
	adresse: string | null;
	codePostal: string | null;
	ville: string | null;
	pays: string;
}

export interface UblLu {
	// A CreditNote document: the amounts below are then negative.
	type: 'facture' | 'note_de_credit';
	numero: string;
	dateEmission: string; // ISO
	dateEcheance: string | null;
	total: number; // TTC, what's actually owed
	fournisseur: UblFournisseur;
	lignes: { libelle: string; quantite: number; prixUnitaire: number }[];
	// A PDF the supplier embedded (AdditionalDocumentReference), decoded.
	pdf: Buffer | null;
}

export class UblError extends Error {}

type Node = Record<string, unknown>;

// fast-xml-parser gives a plain object; `#text` holds a node's text when it also has attributes.
function text(node: unknown): string | null {
	if (node === null || node === undefined) return null;
	if (typeof node === 'string' || typeof node === 'number') return String(node).trim() || null;
	if (typeof node === 'object' && '#text' in (node as Node)) return text((node as Node)['#text']);
	return null;
}
function num(node: unknown): number | null {
	const t = text(node);
	if (t === null) return null;
	const n = Number.parseFloat(t.replace(',', '.'));
	return Number.isFinite(n) ? n : null;
}
function arr(node: unknown): Node[] {
	if (node === undefined || node === null) return [];
	return (Array.isArray(node) ? node : [node]) as Node[];
}
function get(node: unknown, ...path: string[]): unknown {
	let cur: unknown = node;
	for (const key of path) {
		if (!cur || typeof cur !== 'object') return undefined;
		cur = (cur as Node)[key];
		if (Array.isArray(cur)) cur = cur[0];
	}
	return cur;
}

export function parseUbl(xml: string): UblLu {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@',
		removeNSPrefix: true,
		parseTagValue: false
	});
	let doc: Node;
	try {
		doc = parser.parse(xml) as Node;
	} catch {
		throw new UblError('Fichier XML illisible.');
	}
	const root = (doc.Invoice ?? doc.CreditNote) as Node | undefined;
	if (!root) throw new UblError('Ce fichier n’est pas une facture UBL (élément Invoice ou CreditNote absent).');
	const credit = doc.CreditNote !== undefined;

	const numero = text(root.ID);
	const dateEmission = text(root.IssueDate);
	if (!numero || !dateEmission) throw new UblError('Numéro ou date de facture absent du fichier UBL.');

	const supplier = get(root, 'AccountingSupplierParty', 'Party') as Node | undefined;
	if (!supplier) throw new UblError('Fournisseur absent du fichier UBL.');
	const legal = get(supplier, 'PartyLegalEntity') as Node | undefined;
	const address = get(supplier, 'PostalAddress') as Node | undefined;
	const taxIds = arr(supplier.PartyTaxScheme).map((t) => text(t.CompanyID)).filter((s): s is string => !!s);
	const legalId = text(legal?.CompanyID);
	const fournisseur: UblFournisseur = {
		nom: text(legal?.RegistrationName) ?? text(get(supplier, 'PartyName', 'Name')) ?? 'Fournisseur',
		numeroEntreprise: legalId,
		tva: taxIds[0] ?? null,
		email: text(get(supplier, 'Contact', 'ElectronicMail')) ?? null,
		adresse: text(address?.StreetName),
		codePostal: text(address?.PostalZone),
		ville: text(address?.CityName),
		pays: text(get(address, 'Country', 'IdentificationCode')) ?? 'BE'
	};

	const totals = root.LegalMonetaryTotal as Node | undefined;
	const total = num(totals?.PayableAmount) ?? num(totals?.TaxInclusiveAmount);
	if (total === null) throw new UblError('Montant à payer absent du fichier UBL.');

	const lignes = arr(root[credit ? 'CreditNoteLine' : 'InvoiceLine']).map((l) => {
		const quantite = num(l[credit ? 'CreditedQuantity' : 'InvoicedQuantity']) || 1;
		const lineTotal = num(l.LineExtensionAmount) ?? 0;
		// Line amounts in UBL are net of VAT; what the ASBL pays is the gross total, so the lines
		// are scaled to it — the invoice's own lines stay readable, its total stays true.
		return { libelle: text(get(l, 'Item', 'Name')) ?? text(get(l, 'Item', 'Description')) ?? '—', quantite, net: lineTotal };
	});
	const net = lignes.reduce((a, l) => a + l.net, 0);
	const factor = net > 0 ? total / net : 1;
	const lignesTtc = lignes.map((l) => ({
		libelle: l.libelle,
		quantite: l.quantite,
		prixUnitaire: (credit ? -1 : 1) * Math.abs(Math.round(((l.net * factor) / l.quantite) * 100) / 100)
	}));

	let pdf: Buffer | null = null;
	for (const ref of arr(root.AdditionalDocumentReference)) {
		const bin = get(ref, 'Attachment', 'EmbeddedDocumentBinaryObject') as Node | undefined;
		if (bin && String(bin['@mimeCode'] ?? '').toLowerCase() === 'application/pdf') {
			const b64 = text(bin);
			if (b64) {
				pdf = Buffer.from(b64.replace(/\s/g, ''), 'base64');
				break;
			}
		}
	}

	const signedTotal = credit ? -Math.abs(total) : total;
	return {
		type: credit ? 'note_de_credit' : 'facture',
		numero,
		dateEmission,
		dateEcheance: text(root.DueDate) ?? text(get(root, 'PaymentTerms', 'PaymentDueDate')) ?? null,
		total: signedTotal,
		fournisseur,
		lignes: lignesTtc.length > 0 ? lignesTtc : [{ libelle: `${credit ? 'Note de crédit' : 'Facture'} ${numero}`, quantite: 1, prixUnitaire: signedTotal }],
		pdf
	};
}
