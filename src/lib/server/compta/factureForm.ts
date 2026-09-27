import { parseFormDate, parseFormMoney } from './dates';
import type { FactureCotisationType, FactureInput, FactureSens, LigneInput } from './factures';

// Form parsing shared by /compta/factures/nouvelle (create) and /compta/factures/[id] (edit a
// draft). Field names are what FactureForm.svelte posts; lines are repeated fields read with
// getAll(), one entry per row in the same order.

export function parseSens(value: unknown): FactureSens | null {
	return value === 'emise' || value === 'recue' ? value : null;
}

function parseQuantite(value: FormDataEntryValue | null): number | null {
	if (typeof value !== 'string') return null;
	const n = Number.parseFloat(value.trim().replace(',', '.'));
	return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

// Unit prices may be negative (a note de crédit's lines are the original's, negated).
function parsePrix(value: FormDataEntryValue | null): number | null {
	if (typeof value !== 'string') return null;
	const normalised = value.trim().replace(',', '.');
	if (!/^-?\d+(\.\d{1,2})?$/.test(normalised)) return null;
	return Number.parseFloat(normalised);
}

export function factureInputFromForm(formData: FormData): { ok: true; input: FactureInput } | { ok: false; error: string } {
	const sens = parseSens(formData.get('sens'));
	if (!sens) return { ok: false, error: 'Sens invalide.' };
	const tiersId = Number(formData.get('tiersId'));
	if (!Number.isInteger(tiersId) || tiersId <= 0) return { ok: false, error: 'Choisissez un tiers.' };

	const str = (key: string) => String(formData.get(key) ?? '').trim() || null;
	const dateEmissionRaw = formData.get('dateEmission');
	const dateEmission = dateEmissionRaw ? parseFormDate(dateEmissionRaw) : null;
	if (dateEmissionRaw && !dateEmission) return { ok: false, error: 'Date d’émission invalide.' };
	const dateEcheanceRaw = formData.get('dateEcheance');
	const dateEcheance = dateEcheanceRaw ? parseFormDate(dateEcheanceRaw) : null;
	if (dateEcheanceRaw && !dateEcheance) return { ok: false, error: 'Date d’échéance invalide.' };

	const libelles = formData.getAll('ligne_libelle');
	const quantites = formData.getAll('ligne_quantite');
	const prix = formData.getAll('ligne_prix');
	const lignes: LigneInput[] = [];
	for (let i = 0; i < libelles.length; i++) {
		const libelle = String(libelles[i] ?? '').trim();
		// An empty trailing row (the form always offers one) is simply skipped.
		if (!libelle && !String(prix[i] ?? '').trim()) continue;
		if (!libelle) return { ok: false, error: `Ligne ${i + 1} : libellé manquant.` };
		const quantite = parseQuantite(quantites[i] ?? '1');
		if (quantite === null) return { ok: false, error: `Ligne ${i + 1} : quantité invalide.` };
		const prixUnitaire = parsePrix(prix[i] ?? null);
		if (prixUnitaire === null) return { ok: false, error: `Ligne ${i + 1} : prix unitaire invalide.` };
		lignes.push({ libelle, quantite, prixUnitaire });
	}
	if (lignes.length === 0) return { ok: false, error: 'Ajoutez au moins une ligne.' };

	let cotisation: FactureInput['cotisation'] = null;
	const cotisationType = formData.get('cotisationType');
	if (sens === 'emise' && (cotisationType === 'facturee' || cotisationType === 'sponsoring')) {
		const debut = parseFormDate(formData.get('cotisationDebut'));
		const dernierJour = parseFormDate(formData.get('cotisationFin'));
		if (!debut || !dernierJour) return { ok: false, error: 'Période de cotisation invalide.' };
		// The form asks for the last covered day; the model stores an exclusive end.
		const fin = new Date(dernierJour.getTime() + 86_400_000);
		if (fin.getTime() <= debut.getTime()) return { ok: false, error: 'La fin de la période doit suivre son début.' };
		const sieges = Number(formData.get('cotisationSieges') || 1);
		if (!Number.isInteger(sieges) || sieges < 0) return { ok: false, error: 'Nombre de sièges invalide.' };
		cotisation = { type: cotisationType as FactureCotisationType, debut, fin, sieges };
	}

	return {
		ok: true,
		input: {
			sens,
			tiersId,
			dateEmission,
			dateEcheance,
			objet: str('objet'),
			note: str('note'),
			numero: sens === 'recue' ? str('numero') : null,
			lignes,
			cotisation
		}
	};
}

// Kept for the create page: a received invoice's total typed directly (no lines known) becomes one
// line, so the same validation and storage apply.
export { parseFormMoney };
