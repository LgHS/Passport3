import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMemberByEmail, getOwnedInvoiceDocument, DolibarrUnavailableError } from '$lib/server/dolibarr';

// Streams a member's own Dolibarr invoice PDF. Never trusts the route param on its own —
// getOwnedInvoiceDocument() re-fetches the invoice from Dolibarr and checks it actually belongs
// to the caller's own billing third-party before returning anything.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const email = locals.user.email;
	if (!email) {
		error(500, 'Impossible de résoudre votre adresse email pour interroger Dolibarr.');
	}

	const invoiceId = Number(params.id);
	if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
		error(404, 'Facture introuvable.');
	}

	try {
		const member = await getMemberByEmail(email);
		if (!member || !member.fkSoc) {
			error(404, 'Facture introuvable.');
		}

		const document = await getOwnedInvoiceDocument(member.fkSoc, invoiceId);
		if (!document) {
			error(404, 'Facture introuvable.');
		}

		// Cast needed: current TS lib typings for BodyInit don't accept the generic
		// Uint8Array<ArrayBufferLike> shape, even though a Response genuinely accepts any
		// Uint8Array at runtime.
		return new Response(document.content as BodyInit, {
			headers: {
				'Content-Type': document.contentType,
				// Escaped defensively even though `filename` comes from Dolibarr's own trusted
				// response, not directly from user input — cheap insurance against a stray `"` ever
				// breaking the header.
				'Content-Disposition': `attachment; filename="${document.filename.replace(/"/g, "'")}"`
			}
		});
	} catch (err) {
		if (err instanceof DolibarrUnavailableError) {
			error(503, 'Service temporairement indisponible. Réessayez dans quelques instants.');
		}
		throw err;
	}
};
