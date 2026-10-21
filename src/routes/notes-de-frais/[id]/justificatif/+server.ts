import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNoteDeFrais, readJustificatif } from '$lib/server/compta/notesDeFrais';
import { resolveTiersForUser } from '$lib/server/compta/tiers';

// A member's own receipt. Ownership is checked against the caller's tiers; "not found" and "not
// yours" are the same 404.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) redirect(302, '/login');
	const id = Number(params.id);
	const tiers = await resolveTiersForUser(locals.user);
	const note = Number.isInteger(id) && id > 0 ? await getNoteDeFrais(id) : null;
	if (!tiers || !note || note.tiersId !== tiers.id) error(404, 'Justificatif introuvable.');
	const doc = await readJustificatif(note.id);
	if (!doc) error(404, 'Justificatif introuvable.');
	return new Response(doc.bytes as BodyInit, {
		headers: {
			'Content-Type': doc.type,
			'Content-Disposition': `inline; filename="${doc.nom.replace(/[^A-Za-z0-9._-]/g, '_')}"`
		}
	});
};
