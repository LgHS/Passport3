import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import {
	apercuDocument,
	changerStatutDocument,
	getDocumentRecu,
	importerDocument,
	ReceptionError,
	type DocumentRecu
} from '$lib/server/compta/reception';
import { listTiers, tiersDisplayName } from '$lib/server/compta/tiers';
import { factureInputFromForm } from '$lib/server/compta/factureForm';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

async function resolveDocument(params: { id: string }): Promise<DocumentRecu> {
	const id = Number(params.id);
	const doc = Number.isInteger(id) && id > 0 ? await getDocumentRecu(id) : null;
	if (!doc) error(404, 'Document introuvable.');
	return doc;
}

export const load: PageServerLoad = async ({ params }) => {
	const doc = await resolveDocument(params);
	const [apercu, tiers] = await Promise.all([apercuDocument(doc), listTiers({ actifOnly: true })]);
	const v = doc.verification;
	return {
		document: {
			id: doc.id,
			statut: doc.statut,
			recuLe: doc.recuLe,
			expediteur: doc.expediteur,
			sujet: doc.sujet,
			pdfNom: doc.pdfNom,
			ublNom: doc.ublNom,
			factureId: doc.factureId,
			traiteLe: doc.traiteLe,
			traitePar: doc.traitePar
		},
		// The evidence, spelled out — see receptionVerification.ts for what each line means.
		verification: {
			verifie: doc.verifie,
			adresse: v.adresse,
			domaine: v.domaine,
			domaineAccepte: v.domaineAccepte,
			enteteGmail: v.enteteGmail,
			spf: v.spf,
			dkim: v.dkim,
			dmarc: v.dmarc,
			raisons: v.raisons,
			ecartes: v.ecartes ?? []
		},
		facture: apercu.lu
			? {
					type: apercu.lu.type,
					numero: apercu.lu.numero,
					dateEmission: apercu.lu.dateEmission,
					dateEcheance: apercu.lu.dateEcheance,
					total: apercu.lu.total,
					lignes: apercu.lu.lignes,
					fournisseur: apercu.lu.fournisseur,
					pdfIntegre: apercu.lu.pdf !== null
				}
			: null,
		erreurLecture: apercu.erreur,
		fournisseurConnu: apercu.fournisseur,
		doublonFactureId: apercu.doublonFactureId,
		tiers: tiers.map((t) => ({ id: t.id, nom: tiersDisplayName(t) }))
	};
};

export const actions: Actions = {
	importer: async ({ params, request, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const doc = await resolveDocument(params);
		const formData = await request.formData();

		const tiersRaw = String(formData.get('tiersId') ?? '').trim();
		const tiersId = tiersRaw ? Number(tiersRaw) : null;
		if (tiersId !== null && (!Number.isInteger(tiersId) || tiersId <= 0)) return fail(400, { error: 'Tiers invalide.' });

		// A PDF alone: the invoice is what the treasurer typed.
		let saisie = null;
		if (!doc.ublNom) {
			formData.set('sens', 'recue');
			const parsed = factureInputFromForm(formData);
			if (!parsed.ok) return fail(400, { error: parsed.error });
			saisie = parsed.input;
		}

		let factureId: number;
		try {
			const facture = await importerDocument(doc.id, {
				actorLabel: displayName(tresorier),
				tiersId: doc.ublNom ? tiersId : null,
				origineConfirmee: formData.has('origineConfirmee'),
				doublonAccepte: formData.has('doublonAccepte'),
				saisie
			});
			factureId = facture.id;
		} catch (err) {
			if (err instanceof ReceptionError) return fail(400, { error: err.message });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.reception.importer', {}, {
			documentId: doc.id,
			factureId,
			expediteur: doc.verification.adresse,
			origineProuvee: doc.verifie,
			// Recorded because it's the treasurer's word replacing the proof.
			origineConfirmeeParTresorier: !doc.verifie
		});
		redirect(303, `/compta/factures/${factureId}`);
	},

	ecarter: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const doc = await resolveDocument(params);
		try {
			await changerStatutDocument(doc.id, 'ignore', displayName(tresorier));
		} catch (err) {
			if (err instanceof ReceptionError) return fail(400, { error: err.message });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.reception.ecarter', {}, {
			documentId: doc.id
		});
		redirect(303, '/compta/reception');
	},

	retablir: async ({ params, locals }) => {
		const tresorier = requireTresorierUser(locals);
		const doc = await resolveDocument(params);
		try {
			await changerStatutDocument(doc.id, 'a_traiter', displayName(tresorier));
		} catch (err) {
			if (err instanceof ReceptionError) return fail(400, { error: err.message });
			throw err;
		}
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.reception.retablir', {}, {
			documentId: doc.id
		});
		return { success: true };
	}
};
