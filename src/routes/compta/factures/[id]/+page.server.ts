import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import {
	annulerBrouillon,
	annulerPaiement,
	attachPdf,
	corrigerFactureRecue,
	creerNoteDeCredit,
	FactureError,
	getFacture,
	marquerPayee,
	supprimerFactureRecue,
	updateFacture,
	validerFacture
} from '$lib/server/compta/factures';
import { factureInputFromForm } from '$lib/server/compta/factureForm';
import { destinatairesDe, envoyerFacture } from '$lib/server/compta/factureMail';
import { isMailConfigured, MailError } from '$lib/server/compta/mailer';
import { listTiers, tiersDisplayName } from '$lib/server/compta/tiers';
import { parseFormDate } from '$lib/server/compta/dates';
import { listRappels } from '$lib/server/compta/rappels';
import { definirRubrique } from '$lib/server/compta/rubriquesDb';
import { parseRubrique, rubriqueParDefaut } from '$lib/rubriques';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName, type AppUser } from '$lib/types';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

async function loadFacture(params: { id: string }) {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Facture introuvable.');
	const facture = await getFacture(id);
	if (!facture) error(404, 'Facture introuvable.');
	return facture;
}

export const load: PageServerLoad = async ({ params }) => {
	const facture = await loadFacture(params);
	// The tiers list is only needed where the invoice can be edited: a draft, or a received one.
	const tiers = facture.statut === 'brouillon' || facture.sens === 'recue' ? await listTiers({ actifOnly: true }) : [];
	return {
		facture,
		rubriqueParDefaut: rubriqueParDefaut({ type: 'facture', sens: facture.sens, cotisationType: facture.cotisation?.type ?? null }),
		rappels: facture.sens === 'emise' ? await listRappels(facture.id) : [],
		tiers: tiers.map((t) => ({ id: t.id, nom: tiersDisplayName(t), nature: t.nature })),
		mailConfigured: await isMailConfigured(),
		destinataires: facture.sens === 'emise' ? await destinatairesDe(facture) : []
	};
};

function audit(user: AppUser, action: string, factureId: number, details: Record<string, unknown> = {}) {
	return logAuditEvent({ sub: user.sub, label: displayName(user) }, 'admin', action, {}, { factureId, ...details });
}

function echo(formData: FormData) {
	const values: Record<string, string> = {};
	for (const [k, v] of formData.entries()) if (typeof v === 'string' && !k.startsWith('ligne_')) values[k] = v;
	const libelles = formData.getAll('ligne_libelle').map(String);
	const quantites = formData.getAll('ligne_quantite').map(String);
	const prix = formData.getAll('ligne_prix').map(String);
	return { values, lignes: libelles.map((libelle, i) => ({ libelle, quantite: quantites[i] ?? '1', prix: prix[i] ?? '' })) };
}

// Every action funnels FactureError into a 400 with its message: those are business refusals
// ("only a draft can be edited"), not bugs.
async function run<T>(fn: () => Promise<T>, onError: (message: string) => ReturnType<typeof fail>) {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof FactureError) return onError(err.message);
		throw err;
	}
}

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		const formData = await request.formData();
		const parsed = factureInputFromForm(formData);
		if (!parsed.ok) return fail(400, { error: parsed.error, ...echo(formData) });
		if (parsed.input.sens !== facture.sens) return fail(400, { error: 'Le sens d’une facture ne change pas.', ...echo(formData) });
		return run(
			async () => {
				await updateFacture(facture.id, parsed.input);
				await audit(tresorier, 'compta.facture.update', facture.id);
				return { success: 'Brouillon enregistré.' };
			},
			(message) => fail(400, { error: message, ...echo(formData) })
		);
	},

	// A received invoice stays correctable after it was registered (see corrigerFactureRecue).
	corriger: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		const formData = await request.formData();
		formData.set('sens', 'recue');
		const parsed = factureInputFromForm(formData);
		if (!parsed.ok) return fail(400, { error: parsed.error, ...echo(formData) });
		return run(
			async () => {
				const corrigee = await corrigerFactureRecue(facture.id, parsed.input);
				await audit(tresorier, 'compta.facture.corriger', facture.id, {
					avant: { tiersId: facture.tiersId, numero: facture.numero, total: facture.total },
					apres: { tiersId: corrigee.tiersId, numero: corrigee.numero, total: corrigee.total }
				});
				return { success: 'Facture corrigée.' };
			},
			(message) => fail(400, { error: message, ...echo(formData) })
		);
	},

	supprimer: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		const result = await run(
			async () => {
				await supprimerFactureRecue(facture.id);
				await audit(tresorier, 'compta.facture.supprimer', facture.id, { tiersId: facture.tiersId, numero: facture.numero, total: facture.total });
				return null;
			},
			(message) => fail(400, { error: message })
		);
		if (result) return result;
		redirect(303, '/compta/factures?sens=recue');
	},

	annulerPaiement: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		return run(
			async () => {
				await annulerPaiement(facture.id);
				await audit(tresorier, 'compta.facture.annulerPaiement', facture.id, { numero: facture.numero });
				return { success: 'Paiement annulé : la facture est à nouveau à payer.' };
			},
			(message) => fail(400, { error: message })
		);
	},

	rubrique: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		const raw = String((await request.formData()).get('rubrique') ?? '');
		const rubrique = raw ? parseRubrique(raw, facture.sens === 'emise' ? 'recette' : 'depense') : null;
		if (raw && !rubrique) return fail(400, { error: 'Rubrique invalide pour cette facture.' });
		await definirRubrique('facture', facture.id, rubrique);
		await audit(tresorier, 'compta.rubrique.update', facture.id, { rubrique });
		return { success: 'Rubrique enregistrée.' };
	},

	valider: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		return run(
			async () => {
				const validee = await validerFacture(facture.id);
				await audit(tresorier, 'compta.facture.valider', facture.id, { numero: validee.numero, total: validee.total });
				return { success: `Facture ${validee.numero} validée.` };
			},
			(message) => fail(400, { error: message })
		);
	},

	marquerPayee: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		const formData = await request.formData();
		const raw = formData.get('payeeLe');
		const payeeLe = raw ? parseFormDate(raw) : null;
		if (raw && !payeeLe) return fail(400, { error: 'Date de paiement invalide.' });
		return run(
			async () => {
				await marquerPayee(facture.id, payeeLe ?? undefined);
				await audit(tresorier, 'compta.facture.payee', facture.id);
				return { success: 'Facture marquée payée.' };
			},
			(message) => fail(400, { error: message })
		);
	},

	annuler: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		return run(
			async () => {
				await annulerBrouillon(facture.id);
				await audit(tresorier, 'compta.facture.annuler', facture.id);
				return { success: 'Brouillon annulé.' };
			},
			(message) => fail(400, { error: message })
		);
	},

	noteDeCredit: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		let id: number | null = null;
		const failed = await run(
			async () => {
				const nc = await creerNoteDeCredit(facture.id);
				id = nc.id;
				await audit(tresorier, 'compta.facture.noteDeCredit', facture.id, { noteDeCreditId: nc.id });
				return null;
			},
			(message) => fail(400, { error: message })
		);
		if (failed) return failed;
		redirect(303, `/compta/factures/${id}`);
	},

	envoyer: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		try {
			const to = await envoyerFacture(facture.id);
			await audit(tresorier, 'compta.facture.envoyer', facture.id, { to });
			return { success: `Envoyée à ${to.join(', ')}.` };
		} catch (err) {
			if (err instanceof MailError) return fail(400, { error: err.message });
			throw err;
		}
	},

	attachPdf: async ({ request, params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const facture = await loadFacture(params);
		if (facture.sens !== 'recue') return fail(400, { error: 'Le PDF d’une facture émise est généré à la validation.' });
		const formData = await request.formData();
		const pdf = formData.get('pdf');
		if (!(pdf instanceof File) || pdf.size === 0) return fail(400, { error: 'Choisissez un fichier PDF.' });
		if (pdf.type !== 'application/pdf') return fail(400, { error: 'Le fichier doit être un PDF.' });
		if (pdf.size > MAX_PDF_BYTES) return fail(400, { error: 'PDF trop volumineux (10 Mo max).' });
		await attachPdf(facture.id, Buffer.from(await pdf.arrayBuffer()));
		await audit(tresorier, 'compta.facture.pdf', facture.id);
		return { success: 'PDF enregistré.' };
	}
};
