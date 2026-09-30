import PDFDocument from 'pdfkit';
import type { ComptaSettings } from './settings';
import type { Tiers } from './tiers';
import { tiersDisplayName } from './tiers';
import type { Facture } from './factures';

// Renders an issued invoice (or note de crédit) to PDF with pdfkit — pure JS, no browser, which is
// what the read-only, capability-less production container can run. Standard Helvetica (WinAnsi:
// accents and the euro sign are covered), A4, one column layout; long line descriptions wrap.
//
// Called once, at validation (factures.ts): the bytes are stored under DATA_DIR and served as-is
// afterwards, never re-rendered — the document a customer received must stay reproducible even if
// this layout changes later.

const PAGE = { width: 595.28, height: 841.89, margin: 50 };
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;

const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'long', timeZone: 'UTC' });
const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
const quantityFormat = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 3 });

function fmtDate(d: Date | null): string {
	return d ? dateFormat.format(d) : '—';
}

// pdfkit writes to a stream; collect the chunks into one Buffer for storage. Listeners are attached
// before any drawing (pdfkit emits the header right away), but the document is only ended by the
// caller once everything is drawn — ending it here would freeze an empty page.
function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});
}

function addressLines(t: Tiers): string[] {
	const lines = [tiersDisplayName(t)];
	if (t.adresse) lines.push(t.adresse);
	const city = [t.codePostal, t.ville].filter(Boolean).join(' ');
	if (city) lines.push(t.pays && t.pays !== 'BE' ? `${city}, ${t.pays}` : city);
	if (t.numeroEntreprise) lines.push(`N° d'entreprise : ${t.numeroEntreprise}`);
	if (t.email) lines.push(t.email);
	return lines;
}

export async function renderFacturePdf(facture: Facture, tiers: Tiers, settings: ComptaSettings): Promise<Buffer> {
	const doc = new PDFDocument({
		size: 'A4',
		margin: PAGE.margin,
		info: {
			Title: `${facture.type === 'note_de_credit' ? 'Note de crédit' : 'Facture'} ${facture.numero ?? ''}`.trim(),
			Author: settings.emetteurNom
		}
	});
	const done = collect(doc);
	const isCredit = facture.type === 'note_de_credit';

	// --- Issuer (left) and document title (right) ---------------------------------------------
	const top = PAGE.margin;
	doc.font('Helvetica-Bold').fontSize(14).text(settings.emetteurNom, PAGE.margin, top);
	doc.font('Helvetica').fontSize(9);
	for (const line of settings.emetteurAdresse.split(/\r?\n/).filter(Boolean)) doc.text(line);
	doc.text(`N° d'entreprise : ${settings.emetteurNumeroEntreprise}`);
	doc.text(settings.emetteurEmail);

	const titleX = PAGE.width / 2;
	const titleWidth = PAGE.width - PAGE.margin - titleX;
	doc.font('Helvetica-Bold').fontSize(20).text(isCredit ? 'NOTE DE CRÉDIT' : 'FACTURE', titleX, top, {
		width: titleWidth,
		align: 'right'
	});
	doc.font('Helvetica').fontSize(10);
	const meta: [string, string][] = [
		['Numéro', facture.numero ?? '—'],
		['Date', fmtDate(facture.dateEmission)],
		...(isCredit ? [] : ([['Échéance', fmtDate(facture.dateEcheance)]] as [string, string][]))
	];
	// Label and value as one right-aligned string: pdfkit's `continued` + `align: 'right'` lays the
	// two runs over each other.
	let y = doc.y + 6;
	for (const [label, value] of meta) {
		doc.text(`${label} : ${value}`, titleX, y, { width: titleWidth, align: 'right' });
		y = doc.y;
	}

	// --- Recipient --------------------------------------------------------------------------------
	y = Math.max(doc.y, 150) + 20;
	doc.font('Helvetica-Bold').fontSize(9).text('FACTURÉ À', PAGE.margin, y);
	doc.font('Helvetica').fontSize(10);
	for (const line of addressLines(tiers)) doc.text(line);

	if (isCredit && facture.factureOrigineNumero) {
		doc.moveDown(0.8);
		doc.font('Helvetica').fontSize(10).text(`Annule la facture ${facture.factureOrigineNumero}.`);
	}
	if (facture.objet) {
		doc.moveDown(0.8);
		doc.font('Helvetica-Bold').fontSize(10).text('Objet : ', { continued: true }).font('Helvetica').text(facture.objet);
	}

	// --- Lines table ------------------------------------------------------------------------------
	const cols = { libelle: 0, quantite: CONTENT_WIDTH - 210, prixUnitaire: CONTENT_WIDTH - 150, total: CONTENT_WIDTH - 80 };
	const widths = { libelle: cols.quantite - 10, quantite: 50, prixUnitaire: 65, total: 80 };
	y = doc.y + 20;

	const headerHeight = 18;
	doc.rect(PAGE.margin, y, CONTENT_WIDTH, headerHeight).fill('#000000');
	doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
	doc.text('Description', PAGE.margin + cols.libelle + 4, y + 5, { width: widths.libelle });
	doc.text('Qté', PAGE.margin + cols.quantite, y + 5, { width: widths.quantite, align: 'right' });
	doc.text('P.U.', PAGE.margin + cols.prixUnitaire, y + 5, { width: widths.prixUnitaire, align: 'right' });
	doc.text('Total', PAGE.margin + cols.total, y + 5, { width: widths.total, align: 'right' });
	doc.fillColor('#000000').font('Helvetica').fontSize(10);
	y += headerHeight;

	for (const ligne of facture.lignes) {
		const textHeight = doc.heightOfString(ligne.libelle, { width: widths.libelle - 8 });
		const rowHeight = Math.max(textHeight, 12) + 8;
		if (y + rowHeight > PAGE.height - PAGE.margin - 160) {
			doc.addPage();
			y = PAGE.margin;
		}
		doc.text(ligne.libelle, PAGE.margin + cols.libelle + 4, y + 4, { width: widths.libelle - 8 });
		doc.text(quantityFormat.format(ligne.quantite), PAGE.margin + cols.quantite, y + 4, { width: widths.quantite, align: 'right' });
		doc.text(amountFormat.format(ligne.prixUnitaire), PAGE.margin + cols.prixUnitaire, y + 4, { width: widths.prixUnitaire, align: 'right' });
		doc.text(amountFormat.format(ligne.total), PAGE.margin + cols.total, y + 4, { width: widths.total, align: 'right' });
		y += rowHeight;
		doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor('#999999').stroke();
	}

	// --- Total ------------------------------------------------------------------------------------
	y += 10;
	doc.strokeColor('#000000').lineWidth(1);
	doc.font('Helvetica-Bold').fontSize(12);
	doc.text(isCredit ? 'Total à créditer' : 'Total à payer', PAGE.margin + cols.quantite - 60, y, { width: cols.total - cols.quantite + 60 - 4, align: 'right' });
	doc.text(amountFormat.format(Math.abs(facture.total)), PAGE.margin + cols.total, y, { width: widths.total, align: 'right' });
	y = doc.y + 4;
	doc.font('Helvetica').fontSize(9).text(settings.mentionTva, PAGE.margin, y, { width: CONTENT_WIDTH });

	// --- Payment ----------------------------------------------------------------------------------
	if (!isCredit) {
		y = doc.y + 20;
		doc.rect(PAGE.margin, y, CONTENT_WIDTH, 62).lineWidth(1).strokeColor('#000000').stroke();
		doc.font('Helvetica-Bold').fontSize(10).text('PAIEMENT', PAGE.margin + 10, y + 8);
		doc.font('Helvetica').fontSize(10);
		doc.text(`IBAN : ${settings.emetteurIban || '—'}`, PAGE.margin + 10, y + 24);
		doc.text(`Communication structurée : ${facture.communicationStructuree ?? '—'}`, PAGE.margin + 10, y + 38);
		doc.text(`À payer pour le ${fmtDate(facture.dateEcheance)}`, PAGE.margin + 300, y + 24, {
			width: CONTENT_WIDTH - 310,
			align: 'right'
		});
		// Drawing a rect doesn't move the text cursor: place it below the box by hand.
		doc.y = y + 62 + 14;
	}

	if (facture.note) {
		doc.font('Helvetica').fontSize(9).fillColor('#333333').text(facture.note, PAGE.margin, doc.y + 6, { width: CONTENT_WIDTH });
		doc.fillColor('#000000');
	}

	// --- Footer -----------------------------------------------------------------------------------
	// Inside the bottom margin on purpose; pdfkit would otherwise open a new page for text placed
	// past `height - margin.bottom`, so the margin is lifted for this one line.
	doc.page.margins.bottom = 0;
	doc
		.font('Helvetica')
		.fontSize(8)
		.fillColor('#666666')
		.text(
			`${settings.emetteurNom} — ${settings.emetteurNumeroEntreprise} — ${settings.emetteurEmail}`,
			PAGE.margin,
			PAGE.height - PAGE.margin + 10,
			{ width: CONTENT_WIDTH, align: 'center', lineBreak: false }
		);

	doc.end();
	return done;
}
