import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { deciderNoteDeFrais, getNoteDeFrais, listNotesDeFrais, NoteDeFraisError, type NoteStatut } from '$lib/server/compta/notesDeFrais';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

function parseStatut(v: string | null): NoteStatut | undefined {
	return v === 'soumise' || v === 'acceptee' || v === 'refusee' || v === 'remboursee' ? v : undefined;
}

export const load: PageServerLoad = async ({ url }) => {
	const statut = parseStatut(url.searchParams.get('statut'));
	return { statut: statut ?? null, notes: await listNotesDeFrais({ statut }) };
};

export const actions: Actions = {
	decider: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const id = Number(formData.get('noteId'));
		const acceptee = formData.get('decision') === 'accepter';
		const motif = String(formData.get('motif') ?? '').trim() || null;
		const note = Number.isInteger(id) ? await getNoteDeFrais(id) : null;
		if (!note) error(404, 'Note introuvable.');
		try {
			await deciderNoteDeFrais(note.id, { acceptee, motif, par: displayName(tresorier) });
		} catch (err) {
			if (err instanceof NoteDeFraisError) return fail(400, { error: err.message, noteId: note.id });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', acceptee ? 'compta.noteDeFrais.accepter' : 'compta.noteDeFrais.refuser', {}, {
			noteId: note.id,
			tiersId: note.tiersId,
			montant: note.montant,
			motif
		});
		return { success: acceptee ? 'Note acceptée — à rembourser depuis la banque.' : 'Note refusée.' };
	}
};
