import { isValidIban, normalizeIban } from '$lib/server/bankValidation';
import type { TiersInput, TiersNature } from './tiers';

// Form parsing shared by /compta/tiers (create) and /compta/tiers/[id] (update) — one reading of the
// form, one set of messages. Lives here rather than in a +page.server.ts because SvelteKit only
// allows its own exports from those.

export function parseNature(value: unknown): TiersNature | null {
	return value === 'personne_physique' || value === 'personne_morale' ? value : null;
}

export function tiersInputFromForm(formData: FormData): { ok: true; input: TiersInput } | { ok: false; error: string } {
	const nature = parseNature(formData.get('nature'));
	if (!nature) return { ok: false, error: 'Nature invalide.' };
	const nom = String(formData.get('nom') ?? '').trim();
	if (!nom) return { ok: false, error: nature === 'personne_physique' ? 'Le nom est obligatoire.' : 'La dénomination est obligatoire.' };
	const iban = normalizeIban(String(formData.get('iban') ?? ''));
	if (iban && !isValidIban(iban)) return { ok: false, error: 'IBAN invalide (vérifiez le numéro).' };
	const str = (key: string) => String(formData.get(key) ?? '');
	return {
		ok: true,
		input: {
			nature,
			nom,
			prenom: str('prenom'),
			email: str('email'),
			telephone: str('telephone'),
			adresse: str('adresse'),
			codePostal: str('codePostal'),
			ville: str('ville'),
			pays: str('pays') || 'BE',
			numeroEntreprise: str('numeroEntreprise'),
			iban,
			exempteCotisation: formData.has('exempteCotisation'),
			estClient: formData.has('estClient'),
			estFournisseur: formData.has('estFournisseur'),
			actif: !formData.has('inactif'),
			notes: str('notes')
		}
	};
}

