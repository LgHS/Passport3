import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { getComptaSettings } from '$lib/server/compta/settings';
import { getGmailConnexion, isGmailClientConfigured } from '$lib/server/compta/gmail';
import { listDocumentsRecus, ReceptionError, releverBoite, type DocumentStatut } from '$lib/server/compta/reception';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

const STATUTS: DocumentStatut[] = ['a_traiter', 'importe', 'ignore'];

export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('statut');
	const statut = STATUTS.find((s) => s === raw) ?? 'a_traiter';
	const [documents, settings, connexion] = await Promise.all([
		listDocumentsRecus(statut),
		getComptaSettings(),
		isGmailClientConfigured() ? getGmailConnexion() : null
	]);
	return {
		statut,
		boite: connexion?.email ?? null,
		domaines: settings.receptionDomaines,
		auto: settings.receptionAuto,
		documents: documents.map((d) => ({
			id: d.id,
			recuLe: d.recuLe,
			expediteur: d.verification.adresse ?? d.expediteur,
			sujet: d.sujet,
			verifie: d.verifie,
			fournisseur: d.fournisseurNom,
			numero: d.numero,
			total: d.total,
			pdf: d.pdfNom !== null,
			ubl: d.ublNom !== null,
			factureId: d.factureId
		}))
	};
};

export const actions: Actions = {
	relever: async ({ locals }) => {
		const tresorier = requireTresorierUser(locals);
		try {
			const releve = await releverBoite();
			await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.reception.relever', {}, {
				messages: releve.messages,
				documents: releve.documents,
				nonVerifies: releve.nonVerifies,
				erreurs: releve.erreurs.length
			});
			return { releve };
		} catch (err) {
			if (err instanceof ReceptionError) return fail(400, { error: err.message });
			throw err;
		}
	}
};
