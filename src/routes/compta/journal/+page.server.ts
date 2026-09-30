import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTresorierUser } from '$lib/server/auth';
import { anneesDisponibles, getJournal } from '$lib/server/compta/journal';
import { getComptesAnnuels, montantsPatrimoine, saveComptesAnnuels } from '$lib/server/compta/comptesAnnuels';
import { brusselsToday, parseFormDate } from '$lib/server/compta/dates';
import { LIGNES_SAISIES } from '$lib/comptesAnnuels';
import { logAuditEvent } from '$lib/server/auditLog';
import { displayName } from '$lib/types';

const TEXTE_MAX = 10_000;

function anneeDemandee(url: URL, annees: number[]): number {
	const courante = brusselsToday().getUTCFullYear();
	const demandee = Number(url.searchParams.get('annee'));
	return Number.isInteger(demandee) && demandee > 2000 && demandee < 2100 ? demandee : (annees[0] ?? courante);
}

export const load: PageServerLoad = async ({ url }) => {
	const annees = await anneesDisponibles();
	const courante = brusselsToday().getUTCFullYear();
	const annee = anneeDemandee(url, annees);
	const [journal, comptes] = await Promise.all([getJournal(annee), getComptesAnnuels(annee)]);
	return {
		annees: annees.includes(courante) ? annees : [courante, ...annees],
		journal,
		comptes,
		patrimoine: montantsPatrimoine(journal, comptes)
	};
};

// "1 234,56", "-12.5" or empty (0); null when it isn't an amount. Negative is allowed: on a line
// the books compute, what's typed is an adjustment.
function parseMontant(value: FormDataEntryValue | null): number | null {
	const raw = String(value ?? '').replace(/[\s  ]/g, '').replace(',', '.');
	if (raw === '') return 0;
	if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(raw)) return null;
	return Number.parseFloat(raw);
}

export const actions: Actions = {
	// What the books can't know about the year: the annexe's notes and the inventory.
	annexe: async ({ request, locals, url }) => {
		const tresorier = requireTresorierUser(locals);
		const annee = anneeDemandee(url, []);
		const formData = await request.formData();
		const texte = (key: string) => String(formData.get(key) ?? '').replace(/\r\n/g, '\n').trim();

		const montants: Record<string, number> = {};
		for (const key of LIGNES_SAISIES) {
			const n = parseMontant(formData.get(`montant_${key}`));
			if (n === null) return fail(400, { error: `Montant invalide (${key.replace(/_/g, ' ')}).` });
			montants[key] = n;
		}
		const textes = {
			reglesEvaluation: texte('reglesEvaluation'),
			adaptationRegles: texte('adaptationRegles'),
			informationsComplementaires: texte('informationsComplementaires'),
			droitsEngagementsTexte: texte('droitsEngagementsTexte')
		};
		if (Object.values(textes).some((t) => t.length > TEXTE_MAX)) return fail(400, { error: `Texte trop long (${TEXTE_MAX} caractères max).` });
		const approuvesRaw = formData.get('approuvesLe');
		const approuvesLe = approuvesRaw ? parseFormDate(approuvesRaw) : null;
		if (approuvesRaw && !approuvesLe) return fail(400, { error: 'Date d’approbation invalide.' });

		await saveComptesAnnuels(annee, { ...textes, montants, approuvesLe }, displayName(tresorier));
		await logAuditEvent({ sub: tresorier.sub, label: displayName(tresorier) }, 'admin', 'compta.comptesAnnuels.update', {}, { annee });
		return { success: true };
	}
};
