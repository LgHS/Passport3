import { describe, expect, it } from 'vitest';
import {
	adresseDeFrom,
	apparierPieces,
	listerPiecesJointes,
	parseAuthenticationResults,
	verifierExpediteur,
	type PieceJointe
} from '$lib/server/compta/receptionVerification';

const DOMAINES = ['doccle.be'];

// What Gmail stamps on a mail Doccle really sent.
const AUTH_OK =
	'mx.google.com; dkim=pass header.i=@doccle.be header.s=s1 header.b=AbCdEf12; ' +
	'spf=pass (google.com: domain of bounce@mail.doccle.be designates 192.0.2.1 as permitted sender) smtp.mailfrom=bounce@mail.doccle.be; ' +
	'dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=doccle.be';

const headers = (from: string, ...auth: string[]) => [
	{ name: 'From', value: from },
	{ name: 'Subject', value: 'Votre facture' },
	...auth.map((value) => ({ name: 'Authentication-Results', value }))
];

describe('adresseDeFrom', () => {
	it('reads the address, not the display name', () => {
		expect(adresseDeFrom('Doccle <NoReply@Doccle.be>')).toBe('noreply@doccle.be');
		expect(adresseDeFrom('noreply@doccle.be')).toBe('noreply@doccle.be');
	});

	it('is not fooled by an address typed as a display name', () => {
		expect(adresseDeFrom('"noreply@doccle.be" <fraude@exemple.test>')).toBe('fraude@exemple.test');
		expect(adresseDeFrom('"a <noreply@doccle.be>" <fraude@exemple.test>')).toBe('fraude@exemple.test');
	});

	it('refuses several addresses, and what is not an address', () => {
		expect(adresseDeFrom('<a@doccle.be>, <b@exemple.test>')).toBeNull();
		expect(adresseDeFrom('a@doccle.be, b@exemple.test')).toBeNull();
		expect(adresseDeFrom('Doccle')).toBeNull();
		expect(adresseDeFrom(null)).toBeNull();
	});
});

describe('parseAuthenticationResults', () => {
	it('reads each method, its verdict and its properties, ignoring comments', () => {
		const { authservId, resultats } = parseAuthenticationResults(AUTH_OK);
		expect(authservId).toBe('mx.google.com');
		expect(resultats.map((r) => [r.methode, r.resultat])).toEqual([
			['dkim', 'pass'],
			['spf', 'pass'],
			['dmarc', 'pass']
		]);
		expect(resultats[0].proprietes['header.i']).toBe('@doccle.be');
		expect(resultats[2].proprietes['header.from']).toBe('doccle.be');
	});
});

describe('verifierExpediteur', () => {
	it('accepts a mail from Doccle that passed DMARC', () => {
		const v = verifierExpediteur(headers('Doccle <noreply@doccle.be>', AUTH_OK), DOMAINES);
		expect(v.verifie).toBe(true);
		expect(v.raisons).toEqual([]);
		expect(v.dmarc).toEqual({ resultat: 'pass', domaine: 'doccle.be' });
		expect(v.spf).toBe('pass');
	});

	it('accepts a subdomain of an accepted domain', () => {
		const auth = 'mx.google.com; dkim=pass header.i=@mail.doccle.be; dmarc=pass header.from=mail.doccle.be';
		expect(verifierExpediteur(headers('facture@mail.doccle.be', auth), DOMAINES).verifie).toBe(true);
	});

	it('refuses another domain, even fully authenticated', () => {
		const auth = 'mx.google.com; dkim=pass header.i=@exemple.test; spf=pass smtp.mailfrom=exemple.test; dmarc=pass header.from=exemple.test';
		const v = verifierExpediteur(headers('Doccle <noreply@exemple.test>', auth), DOMAINES);
		expect(v.verifie).toBe(false);
		expect(v.domaineAccepte).toBeNull();
	});

	it('refuses a lookalike domain', () => {
		const auth = 'mx.google.com; dkim=pass header.i=@notdoccle.be; dmarc=pass header.from=notdoccle.be';
		expect(verifierExpediteur(headers('noreply@notdoccle.be', auth), DOMAINES).verifie).toBe(false);
		const auth2 = 'mx.google.com; dkim=pass header.i=@doccle.be.exemple.test; dmarc=pass header.from=doccle.be.exemple.test';
		expect(verifierExpediteur(headers('noreply@doccle.be.exemple.test', auth2), DOMAINES).verifie).toBe(false);
	});

	it('refuses a forged From: DMARC failed', () => {
		const auth = 'mx.google.com; spf=pass smtp.mailfrom=exemple.test; dkim=pass header.i=@exemple.test; dmarc=fail (p=REJECT) header.from=doccle.be';
		const v = verifierExpediteur(headers('Doccle <noreply@doccle.be>', auth), DOMAINES);
		expect(v.verifie).toBe(false);
		expect(v.raisons.join(' ')).toContain('DMARC');
	});

	it('does not let a valid DKIM signature make up for a failed DMARC', () => {
		const auth = 'mx.google.com; dkim=pass header.i=@doccle.be; dmarc=fail header.from=doccle.be';
		expect(verifierExpediteur(headers('noreply@doccle.be', auth), DOMAINES).verifie).toBe(false);
	});

	it('falls back on an aligned DKIM signature when there is no DMARC verdict', () => {
		const ok = 'mx.google.com; dkim=pass header.i=@doccle.be; spf=pass smtp.mailfrom=doccle.be';
		expect(verifierExpediteur(headers('noreply@doccle.be', ok), DOMAINES).verifie).toBe(true);
		const autreSignataire = 'mx.google.com; dkim=pass header.i=@exemple.test; spf=pass smtp.mailfrom=doccle.be';
		expect(verifierExpediteur(headers('noreply@doccle.be', autreSignataire), DOMAINES).verifie).toBe(false);
	});

	it('does not accept SPF alone', () => {
		const auth = 'mx.google.com; spf=pass smtp.mailfrom=doccle.be';
		expect(verifierExpediteur(headers('noreply@doccle.be', auth), DOMAINES).verifie).toBe(false);
	});

	it('ignores a verdict that is not Gmail’s own', () => {
		const forge = 'mail.exemple.test; dkim=pass header.i=@doccle.be; dmarc=pass header.from=doccle.be';
		const v = verifierExpediteur(headers('noreply@doccle.be', forge), DOMAINES);
		expect(v.verifie).toBe(false);
		expect(v.enteteGmail).toBe(false);
	});

	it('reads Gmail’s verdict, not a forged one further down', () => {
		const gmail = 'mx.google.com; dmarc=fail header.from=doccle.be';
		const forge = 'mx.google.com; dkim=pass header.i=@doccle.be; dmarc=pass header.from=doccle.be';
		expect(verifierExpediteur(headers('noreply@doccle.be', gmail, forge), DOMAINES).verifie).toBe(false);
	});

	it('refuses a mail with two From headers, or none', () => {
		const deux = [{ name: 'From', value: 'fraude@exemple.test' }, ...headers('noreply@doccle.be', AUTH_OK)];
		expect(verifierExpediteur(deux, DOMAINES).verifie).toBe(false);
		expect(verifierExpediteur([{ name: 'Authentication-Results', value: AUTH_OK }], DOMAINES).verifie).toBe(false);
	});

	it('refuses everything when no domain is accepted', () => {
		expect(verifierExpediteur(headers('noreply@doccle.be', AUTH_OK), []).verifie).toBe(false);
	});
});

const UBL = (numero: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
	xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
	xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
	<cbc:ID>${numero}</cbc:ID>
	<cbc:IssueDate>2026-09-01</cbc:IssueDate>
	<cbc:DueDate>2026-09-30</cbc:DueDate>
	<cac:AccountingSupplierParty><cac:Party>
		<cac:PartyLegalEntity><cbc:RegistrationName>Fournisseur Test SA</cbc:RegistrationName><cbc:CompanyID>0123456749</cbc:CompanyID></cac:PartyLegalEntity>
	</cac:Party></cac:AccountingSupplierParty>
	<cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">121.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
	<cac:InvoiceLine><cbc:InvoicedQuantity>1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
		<cac:Item><cbc:Name>Électricité</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`;

const pdf = (nom: string): PieceJointe => ({ nom, type: 'pdf', bytes: Buffer.from('%PDF-1.7\n…') });
const xml = (nom: string, contenu: string): PieceJointe => ({ nom, type: 'xml', bytes: Buffer.from(contenu) });

describe('apparierPieces', () => {
	it('pairs the UBL with the only PDF, whatever their names', () => {
		const { documents, ecartes } = apparierPieces([pdf('Facture.pdf'), xml('ubl-123.xml', UBL('F-1'))]);
		expect(ecartes).toEqual([]);
		expect(documents).toHaveLength(1);
		expect(documents[0].pdf?.nom).toBe('Facture.pdf');
		expect(documents[0].lu?.numero).toBe('F-1');
		// Net 100, payable 121: the line carries what is actually paid.
		expect(documents[0].lu?.lignes[0].prixUnitaire).toBe(121);
	});

	it('pairs several invoices by file name', () => {
		const { documents } = apparierPieces([pdf('b.pdf'), xml('a.xml', UBL('A')), pdf('A.PDF'), xml('b.xml', UBL('B'))]);
		expect(documents.map((d) => [d.lu?.numero, d.pdf?.nom])).toEqual([
			['A', 'A.PDF'],
			['B', 'b.pdf']
		]);
	});

	it('keeps a PDF without UBL as a document to enter by hand', () => {
		const { documents } = apparierPieces([pdf('scan.pdf')]);
		expect(documents).toHaveLength(1);
		expect(documents[0].lu).toBeNull();
	});

	it('does not guess when names do not match and there are several invoices', () => {
		const { documents } = apparierPieces([xml('a.xml', UBL('A')), xml('b.xml', UBL('B')), pdf('x.pdf')]);
		expect(documents.filter((d) => d.ubl).every((d) => d.pdf === null)).toBe(true);
		expect(documents).toHaveLength(3);
	});

	it('sets aside XML that is not UBL and files that are not PDFs', () => {
		const faux: PieceJointe = { nom: 'facture.pdf', type: 'pdf', bytes: Buffer.from('MZ\u0090\u0000') };
		const { documents, ecartes } = apparierPieces([xml('autre.xml', '<note>bonjour</note>'), faux]);
		expect(documents).toEqual([]);
		expect(ecartes).toHaveLength(2);
	});
});

describe('listerPiecesJointes', () => {
	it('walks the MIME tree and keeps PDF and XML attachments only', () => {
		const pieces = listerPiecesJointes({
			mimeType: 'multipart/mixed',
			parts: [
				{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', filename: '', body: { size: 10, data: 'PGI-' } }] },
				{ mimeType: 'application/pdf', filename: 'facture.pdf', body: { attachmentId: 'att-1', size: 1000 } },
				{ mimeType: 'application/octet-stream', filename: '../../ubl.XML', body: { attachmentId: 'att-2', size: 500 } },
				{ mimeType: 'image/png', filename: 'logo.png', body: { attachmentId: 'att-3', size: 50 } }
			]
		});
		expect(pieces.map((p) => [p.nom, p.type, p.attachmentId])).toEqual([
			['facture.pdf', 'pdf', 'att-1'],
			['.._.._ubl.XML', 'xml', 'att-2']
		]);
	});
});
