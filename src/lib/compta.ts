// Client-safe labels for the compta pages — no server imports here, this file is bundled into
// the browser. The types they key on live in $lib/server/compta/factures.ts.

export type FactureStatut = 'brouillon' | 'validee' | 'payee' | 'annulee';

export const FACTURE_STATUT_LABEL: Record<FactureStatut, string> = {
	brouillon: 'Brouillon',
	validee: 'À payer',
	payee: 'Payée',
	annulee: 'Annulée'
};

// A validated note de crédit is money the ASBL owes back, not money it's waiting for.
export function factureStatutLabel(statut: FactureStatut, type: 'facture' | 'note_de_credit'): string {
	return type === 'note_de_credit' && statut === 'validee' ? 'À rembourser' : FACTURE_STATUT_LABEL[statut];
}

export const FACTURE_STATUT_CLASS: Record<FactureStatut, string> = {
	brouillon: 'text-gray-600',
	validee: 'text-orange-600',
	payee: 'text-green-700',
	annulee: 'text-gray-400 line-through'
};
