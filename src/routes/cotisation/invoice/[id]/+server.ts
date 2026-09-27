import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listOrganisationsAdministrees, resolveTiersForUser } from '$lib/server/compta/tiers';
import { getOwnedInvoiceDocument, DolibarrUnavailableError } from '$lib/server/dolibarr';

// Streams a member's own Dolibarr invoice PDF (phase-1 bridge: invoices stay in Dolibarr until the
// factures table lands, see docs/compta.md). Never trusts the route param on its own —
// getOwnedInvoiceDocument() re-fetches the invoice from Dolibarr and checks it actually belongs to
// one of the caller's own Dolibarr third parties before returning anything.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const invoiceId = Number(params.id);
	if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
		error(404, 'Facture introuvable.');
	}

	const tiers = await resolveTiersForUser(locals.user);
	if (!tiers) {
		error(404, 'Facture introuvable.');
	}

	// The member's own third party (a person invoiced directly) and those of the organisations
	// they administer — the same set /cotisation lists invoices for.
	const organisations = await listOrganisationsAdministrees(tiers.id);
	const socIds = [tiers, ...organisations].map((t) => t.dolibarrSocId).filter((id): id is number => id !== null);

	try {
		for (const socId of socIds) {
			const document = await getOwnedInvoiceDocument(socId, invoiceId);
			if (!document) continue;

			// Cast needed: current TS lib typings for BodyInit don't accept the generic
			// Uint8Array<ArrayBufferLike> shape, even though a Response genuinely accepts any
			// Uint8Array at runtime.
			return new Response(document.content as BodyInit, {
				headers: {
					'Content-Type': document.contentType,
					// Escaped defensively even though `filename` comes from Dolibarr's own trusted
					// response, not directly from user input — cheap insurance against a stray `"`
					// ever breaking the header.
					'Content-Disposition': `attachment; filename="${document.filename.replace(/"/g, "'")}"`
				}
			});
		}
	} catch (err) {
		if (err instanceof DolibarrUnavailableError) {
			error(503, 'Service temporairement indisponible. Réessayez dans quelques instants.');
		}
		throw err;
	}

	error(404, 'Facture introuvable.');
};
