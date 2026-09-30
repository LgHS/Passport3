import { lienPassport, notifierCompta } from '$lib/server/compta/comptaNotifications';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { creerNoteDeFrais, listNotesDeFrais, NoteDeFraisError, retirerNoteDeFrais } from '$lib/server/compta/notesDeFrais';
import { resolveTiersForUser } from '$lib/server/compta/tiers';
import { brusselsToday, parseFormDate, parseFormMoney } from '$lib/server/compta/dates';
import { logAuditEvent } from '$lib/server/auditLog';
import { authentikPk, displayName } from '$lib/types';

// 10 MB, and only the kinds of file a receipt comes as.
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	const tiers = await resolveTiersForUser(locals.user);
	return {
		// null: no tiers yet — the page explains, same as /cotisation's "compte introuvable".
		tiers: tiers ? { id: tiers.id, iban: tiers.iban } : null,
		notes: tiers ? await listNotesDeFrais({ tiersId: tiers.id }) : []
	};
};

export const actions: Actions = {
	soumettre: async ({ request, locals }) => {
		if (!locals.user) redirect(302, '/login');
		const tiers = await resolveTiersForUser(locals.user);
		if (!tiers) error(404, 'Aucun tiers trouvé pour votre compte.');

		const formData = await request.formData();
		const date = parseFormDate(formData.get('date')) ?? (formData.get('date') ? null : brusselsToday());
		const libelle = String(formData.get('libelle') ?? '').trim();
		const montant = parseFormMoney(formData.get('montant'));
		const file = formData.get('justificatif');
		const echo = { values: { date: String(formData.get('date') ?? ''), libelle, montant: String(formData.get('montant') ?? '') } };
		if (!date) return fail(400, { ...echo, error: 'Date invalide.' });
		if (date.getTime() > brusselsToday().getTime()) return fail(400, { ...echo, error: 'La date ne peut pas être dans le futur.' });
		if (!libelle) return fail(400, { ...echo, error: 'Décrivez la dépense.' });
		if (montant === null || montant <= 0) return fail(400, { ...echo, error: 'Montant invalide.' });

		let justificatif = null;
		if (file instanceof File && file.size > 0) {
			if (file.size > MAX_BYTES) return fail(400, { ...echo, error: 'Justificatif trop volumineux (10 Mo max).' });
			if (!ALLOWED_TYPES.has(file.type)) return fail(400, { ...echo, error: 'Le justificatif doit être un PDF ou une image.' });
			justificatif = { nom: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
		} else {
			return fail(400, { ...echo, error: 'Le justificatif est obligatoire.' });
		}

		const note = await creerNoteDeFrais({ tiersId: tiers.id, date, libelle, montant, justificatif });
		// Best effort, and only if the treasury switched it on; the label stays out of the channel.
		await notifierCompta(
			'notesDeFrais',
			`🧾 Note de frais de ${montant.toFixed(2).replace('.', ',')} € soumise par ${displayName(locals.user!)} : ${lienPassport('/compta/notes-de-frais?statut=soumise', 'à traiter')}`
		);
		const pk = authentikPk(locals.user);
		await logAuditEvent({ sub: locals.user.sub, label: displayName(locals.user) }, 'user', 'noteDeFrais.soumettre', pk ? { pk } : { email: locals.user.email }, {
			noteId: note.id,
			montant
		});
		return { success: 'Note de frais envoyée à la trésorerie.' };
	},

	retirer: async ({ request, locals }) => {
		if (!locals.user) redirect(302, '/login');
		const tiers = await resolveTiersForUser(locals.user);
		if (!tiers) error(404, 'Aucun tiers trouvé pour votre compte.');
		const formData = await request.formData();
		const id = Number(formData.get('noteId'));
		try {
			await retirerNoteDeFrais(id, tiers.id);
		} catch (err) {
			if (err instanceof NoteDeFraisError) return fail(400, { error: err.message });
			throw err;
		}
		const pk = authentikPk(locals.user);
		await logAuditEvent({ sub: locals.user.sub, label: displayName(locals.user) }, 'user', 'noteDeFrais.retirer', pk ? { pk } : { email: locals.user.email }, {
			noteId: id
		});
		return { success: 'Note retirée.' };
	}
};
