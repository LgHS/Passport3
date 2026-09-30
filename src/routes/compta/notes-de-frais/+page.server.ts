import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import {
	corrigerNoteDeFrais,
	deciderNoteDeFrais,
	getNoteDeFrais,
	listNotesDeFrais,
	NoteDeFraisError,
	reouvrirNoteDeFrais,
	type NoteStatut
} from '$lib/server/compta/notesDeFrais';
import { parseFormDate, parseFormMoney } from '$lib/server/compta/dates';
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
	},

	// Takes an acceptance or a refusal back.
	reouvrir: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const id = Number((await request.formData()).get('noteId'));
		const note = Number.isInteger(id) ? await getNoteDeFrais(id) : null;
		if (!note) error(404, 'Note introuvable.');
		try {
			await reouvrirNoteDeFrais(note.id);
		} catch (err) {
			if (err instanceof NoteDeFraisError) return fail(400, { error: err.message, noteId: note.id });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.noteDeFrais.reouvrir', {}, {
			noteId: note.id,
			tiersId: note.tiersId,
			statutPrecedent: note.statut
		});
		return { success: 'Décision annulée : la note attend à nouveau une décision.' };
	},

	corriger: async ({ request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const formData = await request.formData();
		const id = Number(formData.get('noteId'));
		const note = Number.isInteger(id) ? await getNoteDeFrais(id) : null;
		if (!note) error(404, 'Note introuvable.');
		const date = parseFormDate(formData.get('date'));
		const montant = parseFormMoney(formData.get('montant'));
		const libelle = String(formData.get('libelle') ?? '').trim();
		if (!date) return fail(400, { error: 'Date invalide.', noteId: note.id });
		if (montant === null) return fail(400, { error: 'Montant invalide.', noteId: note.id });
		try {
			await corrigerNoteDeFrais(note.id, { date, libelle, montant });
		} catch (err) {
			if (err instanceof NoteDeFraisError) return fail(400, { error: err.message, noteId: note.id });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.noteDeFrais.corriger', {}, {
			noteId: note.id,
			tiersId: note.tiersId,
			avant: { montant: note.montant, libelle: note.libelle },
			apres: { montant, libelle }
		});
		return { success: 'Note corrigée.' };
	}
};
