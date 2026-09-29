import type { GmailHeader, GmailPart } from './gmail';
import { parseUbl, UblError, type UblLu } from './ubl';

// The parts of the mailbox collection that don't touch the network or the database: is this mail
// really from Doccle, which attachments does it carry, and which of them go together. Kept apart
// from reception.ts so they can be tested as plain functions.

// ---------------------------------------------------------------------------------------------
// Sender check
//
// The From header is whatever the sender typed, so it proves nothing by itself. What does is the
// verdict Gmail reached when it received the mail, recorded in the Authentication-Results header
// it adds (RFC 8601): DKIM (the message is signed by the domain), SPF (the sending server is
// allowed to send for the envelope domain) and DMARC (one of the two passed *for the domain shown
// in From*). A mail counts as verified when its From domain is an accepted one and DMARC passed
// for it — or, for a domain that publishes no DMARC policy, when a DKIM signature of that same
// domain passed. SPF alone is not enough: it's about the envelope, not about From.

// Gmail stamps its verdict under this name. A header carrying another name was added by someone
// else along the way and is ignored.
const GMAIL_AUTHSERV_ID = 'mx.google.com';

export interface AuthResult {
	methode: string; // dkim, spf, dmarc, arc…
	resultat: string; // pass, fail, neutral, none…
	// header.i, header.d, header.from, smtp.mailfrom…
	proprietes: Record<string, string>;
}

export interface Verification {
	// The address in From, lowercased; null when the header is absent or carries several.
	adresse: string | null;
	domaine: string | null;
	// The accepted domain the From domain falls under, if any.
	domaineAccepte: string | null;
	// Whether Gmail's own Authentication-Results header was found.
	enteteGmail: boolean;
	resultats: AuthResult[];
	spf: string | null;
	dkim: { resultat: string; domaine: string | null }[];
	dmarc: { resultat: string; domaine: string | null } | null;
	verifie: boolean;
	// One sentence per thing that went wrong — empty when verified.
	raisons: string[];
}

export function headerValue(headers: GmailHeader[], name: string): string | null {
	const lower = name.toLowerCase();
	return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

// The single address of a From header. Display names are ignored — `"noreply@doccle.be"
// <someone@elsewhere.example>` is from elsewhere.example — and a From with several addresses, or
// none that parses, yields null.
export function adresseDeFrom(from: string | null): string | null {
	if (!from) return null;
	// Drop quoted display names first, so a '<' or ',' inside one can't confuse what follows.
	const sansGuillemets = from.replace(/"(?:[^"\\]|\\.)*"/g, '');
	const entreChevrons = [...sansGuillemets.matchAll(/<([^<>]*)>/g)].map((m) => m[1].trim());
	let adresse: string;
	if (entreChevrons.length === 1) adresse = entreChevrons[0];
	else if (entreChevrons.length === 0 && !sansGuillemets.includes(',')) adresse = sansGuillemets.trim();
	else return null;
	adresse = adresse.toLowerCase();
	return /^[^\s@<>(),;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(adresse) ? adresse : null;
}

// `domaine` is `parent` or one of its subdomains.
export function sousDomaineDe(domaine: string, parent: string): boolean {
	return domaine === parent || domaine.endsWith(`.${parent}`);
}

function sansCommentaires(value: string): string {
	// Comments are in parentheses and can nest; they carry no verdict.
	let depth = 0;
	let out = '';
	for (const ch of value) {
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
		else if (depth === 0) out += ch;
	}
	return out;
}

export function parseAuthenticationResults(value: string): { authservId: string; resultats: AuthResult[] } {
	const [head, ...rest] = sansCommentaires(value)
		.split(';')
		.map((p) => p.trim().replace(/\s+/g, ' '));
	// "mx.google.com" or "mx.google.com 1" (a version number may follow).
	const authservId = (head ?? '').split(' ')[0].toLowerCase();
	const resultats: AuthResult[] = [];
	for (const piece of rest) {
		const m = /^([a-z0-9-]+)\s*=\s*([a-z]+)\b(.*)$/i.exec(piece);
		if (!m) continue;
		const proprietes: Record<string, string> = {};
		for (const p of m[3].matchAll(/([a-z0-9-]+\.[a-z0-9-]+)\s*=\s*(\S+)/gi)) {
			proprietes[p[1].toLowerCase()] = p[2].toLowerCase();
		}
		resultats.push({ methode: m[1].toLowerCase(), resultat: m[2].toLowerCase(), proprietes });
	}
	return { authservId, resultats };
}

function domaineDe(value: string | undefined): string | null {
	if (!value) return null;
	// header.i is "@doccle.be" or "user@doccle.be"; header.d and header.from are bare domains.
	const d = value.includes('@') ? value.slice(value.lastIndexOf('@') + 1) : value;
	return d.replace(/[<>"]/g, '') || null;
}

export function verifierExpediteur(headers: GmailHeader[], domainesAcceptes: string[]): Verification {
	const raisons: string[] = [];
	const froms = headers.filter((h) => h.name.toLowerCase() === 'from');
	const adresse = froms.length === 1 ? adresseDeFrom(froms[0].value) : null;
	const domaine = adresse ? adresse.slice(adresse.indexOf('@') + 1) : null;
	if (froms.length > 1) raisons.push('Le mail porte plusieurs en-têtes From.');
	else if (!adresse) raisons.push('L’adresse de l’expéditeur est absente ou illisible.');

	const acceptes = domainesAcceptes.map((d) => d.trim().toLowerCase()).filter(Boolean);
	const domaineAccepte = domaine ? (acceptes.find((a) => sousDomaineDe(domaine, a)) ?? null) : null;
	if (domaine && !domaineAccepte) raisons.push(`Le domaine ${domaine} ne fait pas partie des domaines acceptés.`);

	// Gmail's header is the topmost with its name; take the first and only that one.
	const parsed = headers
		.filter((h) => h.name.toLowerCase() === 'authentication-results')
		.map((h) => parseAuthenticationResults(h.value))
		.find((r) => r.authservId === GMAIL_AUTHSERV_ID);
	const resultats = parsed?.resultats ?? [];
	if (!parsed) raisons.push('Gmail n’a enregistré aucun contrôle d’authenticité pour ce mail.');

	const spf = resultats.find((r) => r.methode === 'spf')?.resultat ?? null;
	const dkim = resultats
		.filter((r) => r.methode === 'dkim')
		.map((r) => ({ resultat: r.resultat, domaine: domaineDe(r.proprietes['header.d'] ?? r.proprietes['header.i']) }));
	const dmarcRow = resultats.find((r) => r.methode === 'dmarc');
	const dmarc = dmarcRow ? { resultat: dmarcRow.resultat, domaine: domaineDe(dmarcRow.proprietes['header.from']) } : null;

	let prouve = false;
	if (parsed && domaine && domaineAccepte) {
		const dmarcOk = dmarc?.resultat === 'pass' && dmarc.domaine === domaine;
		// Aligned DKIM: the signing domain is under the same accepted domain as From.
		const dkimOk = dkim.some((d) => d.resultat === 'pass' && d.domaine !== null && sousDomaineDe(d.domaine, domaineAccepte));
		// A DMARC verdict other than "pass" is a failure the domain itself asked to be enforced;
		// DKIM only stands in when there's no DMARC verdict at all.
		const dmarcAbsent = !dmarc || dmarc.resultat === 'none';
		prouve = dmarcOk || (dmarcAbsent && dkimOk);
		if (!prouve) {
			if (dmarc && !dmarcOk && !dmarcAbsent) raisons.push(`DMARC : ${dmarc.resultat} pour ${dmarc.domaine ?? 'un domaine inconnu'}.`);
			else if (!dkimOk) raisons.push(`Aucune signature DKIM valide du domaine ${domaineAccepte}.`);
		}
	}

	return {
		adresse,
		domaine,
		domaineAccepte,
		enteteGmail: !!parsed,
		resultats,
		spf,
		dkim,
		dmarc,
		verifie: prouve && raisons.length === 0,
		raisons
	};
}

// ---------------------------------------------------------------------------------------------
// Attachments

export type PieceType = 'pdf' | 'xml';

export interface PieceJointeRef {
	nom: string;
	type: PieceType;
	taille: number;
	// One of the two: small attachments come inline (base64url), the others by id.
	attachmentId: string | null;
	data: string | null;
}

function typeDePiece(part: GmailPart): PieceType | null {
	const nom = (part.filename ?? '').toLowerCase();
	const mime = (part.mimeType ?? '').toLowerCase();
	if (nom.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
	if (nom.endsWith('.xml') || mime === 'application/xml' || mime === 'text/xml') return 'xml';
	return null;
}

// Every PDF or XML attachment of a message, walking the MIME tree. Parts without a file name are
// the mail's own body, not attachments.
export function listerPiecesJointes(payload: GmailPart): PieceJointeRef[] {
	const out: PieceJointeRef[] = [];
	const walk = (part: GmailPart) => {
		if (part.filename && part.body) {
			const type = typeDePiece(part);
			if (type && (part.body.attachmentId || part.body.data)) {
				out.push({
					// A file name is shown and offered for download: no path, no control character.
					nom: part.filename.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200),
					type,
					taille: part.body.size ?? 0,
					attachmentId: part.body.attachmentId ?? null,
					data: part.body.data ?? null
				});
			}
		}
		for (const child of part.parts ?? []) walk(child);
	};
	walk(payload);
	return out;
}

export interface PieceJointe {
	nom: string;
	type: PieceType;
	bytes: Buffer;
}

export interface DocumentTrouve {
	pdf: PieceJointe | null;
	ubl: PieceJointe | null;
	// The UBL, read — null for a PDF alone.
	lu: UblLu | null;
}

export function estPdf(bytes: Buffer): boolean {
	return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

const sansExtension = (nom: string) => nom.replace(/\.[^.]+$/, '').toLowerCase();

// Groups a mail's attachments into invoices. Each XML that reads as a UBL invoice is one; its PDF
// is the attachment of the same name, or the mail's only PDF when there's a single invoice. PDFs
// left over are documents of their own, to be entered by hand. XML that isn't UBL, and files that
// claim to be PDF but aren't, are reported rather than kept.
export function apparierPieces(pieces: PieceJointe[]): { documents: DocumentTrouve[]; ecartes: string[] } {
	const ecartes: string[] = [];
	const pdfs: PieceJointe[] = [];
	const documents: DocumentTrouve[] = [];

	for (const p of pieces) {
		if (p.type === 'pdf') {
			if (estPdf(p.bytes)) pdfs.push(p);
			else ecartes.push(`${p.nom} : n’est pas un PDF.`);
			continue;
		}
		try {
			documents.push({ pdf: null, ubl: p, lu: parseUbl(p.bytes.toString('utf8')) });
		} catch (err) {
			if (!(err instanceof UblError)) throw err;
			ecartes.push(`${p.nom} : ${err.message}`);
		}
	}

	const libres = new Set(pdfs);
	for (const doc of documents) {
		const pdf = [...libres].find((p) => sansExtension(p.nom) === sansExtension(doc.ubl!.nom));
		if (pdf) {
			doc.pdf = pdf;
			libres.delete(pdf);
		}
	}
	const sansPdf = documents.filter((d) => !d.pdf);
	if (sansPdf.length === 1 && documents.length === 1 && libres.size === 1) {
		const [pdf] = libres;
		sansPdf[0].pdf = pdf;
		libres.delete(pdf);
	}
	for (const pdf of libres) documents.push({ pdf, ubl: null, lu: null });
	return { documents, ecartes };
}
