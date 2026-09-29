<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const dateFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeZone: 'UTC' });
	const dateTimeFormat = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' });
	const amountFormat = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });

	// Nothing is ticked to begin with: sending is a decision, not a default.
	let selection = $state<number[]>([]);
	let submitting = $state(false);
	let complement = $state('');

	const envoyables = $derived(data.factures.filter((f) => f.to.length > 0));
	const totalSelection = $derived(data.factures.filter((f) => selection.includes(f.id)).reduce((a, f) => a + f.reste, 0));

	$effect(() => {
		if (!form) return;
		if ('error' in form && form.error) showToast('error', form.error);
		else if ('envoyes' in form && form.envoyes) {
			if (form.echecs.length > 0) showToast('error', `${form.envoyes.length} rappel(s) envoyé(s), ${form.echecs.length} échec(s) : ${form.echecs.join(' ')}`);
			else showToast('success', `${form.envoyes.length} rappel(s) envoyé(s).`);
		}
	});

	const RANG = ['', '1er rappel', '2e rappel', 'Dernier rappel'];
	const rang = (n: number) => RANG[Math.min(n, 3)];
	const h2 = 'mb-4 bg-black px-4 py-3 text-base font-bold text-white uppercase';
	const th = 'border border-black px-3 py-2 text-left';
	const td = 'border border-black px-3 py-2 align-top';
</script>

<svelte:head>
	<title>Rappels — Compta — Passport</title>
</svelte:head>

<section>
	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Rappels de paiement</h1>

	<p class="mb-6 border border-black bg-gray-100 px-4 py-3 text-sm">
		Factures émises échues et non payées. Une facture est proposée au rappel {data.delai} jour(s) après son échéance, puis
		{data.delai} jour(s) après chaque rappel (<a href="/compta/parametres">paramètres</a>). Aucun rappel ne part sans être
		coché ici.
		{#if !data.mailConfigured}
			<span class="mt-2 block font-bold text-red-700">
				Aucune boîte Gmail connectée : <a href="/compta/parametres#gmail">connectez-la</a> pour pouvoir envoyer.
			</span>
		{/if}
	</p>

	{#if data.factures.length > 0}
		<form
			method="POST"
			action="?/envoyer"
			use:enhance={({ cancel }) => {
				if (!confirm(`Envoyer ${selection.length} rappel(s) par email ?`)) return cancel();
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
					selection = [];
				};
			}}
		>
			<table class="table-cards mb-4 w-full border-collapse text-sm">
				<thead>
					<tr class="bg-black text-white uppercase">
						<th class="{th} w-10"></th>
						<th class={th}>Facture</th>
						<th class={th}>Client</th>
						<th class={th}>Échéance</th>
						<th class="{th} text-right">Reste dû</th>
						<th class={th}>Rappels</th>
						<th class={th}>À envoyer</th>
					</tr>
				</thead>
				<tbody>
					{#each data.factures as f (f.id)}
						<tr class={f.aRelancer ? '' : 'text-gray-600'}>
							<td class="{td} sm:text-center">
								<label class="flex items-center gap-2">
									<input type="checkbox" name="factureId" value={f.id} bind:group={selection} disabled={f.to.length === 0} />
									<span class="font-bold sm:hidden">Envoyer ce rappel</span>
								</label>
							</td>
							<td class={td} data-label="Facture"><a href="/compta/factures/{f.id}" class="font-bold">{f.numero}</a></td>
							<td class={td} data-label="Client"><a href="/compta/tiers/{f.tiersId}">{f.tiersNom}</a></td>
							<td class={td} data-label="Échéance">
								<span>
									{dateFormat.format(f.dateEcheance)}
									<span class="block text-xs font-bold text-red-700">{f.joursRetard} jour(s) de retard</span>
								</span>
							</td>
							<td class="{td} sm:text-right" data-label="Reste dû">
								<span>
									<span class="font-bold">{amountFormat.format(f.reste)}</span>
									{#if f.reste < f.total}<span class="block text-xs text-gray-600">sur {amountFormat.format(f.total)}</span>{/if}
								</span>
							</td>
							<td class={td} data-label="Rappels">
								<span>
									{f.rappelsEnvoyes === 0 ? 'Aucun' : `${f.rappelsEnvoyes} envoyé(s)`}
									{#if f.dernierRappel}<span class="block text-xs text-gray-600">dernier le {dateFormat.format(f.dernierRappel)}</span>{/if}
									{#if !f.aRelancer && f.prochainRappel}
										<span class="block text-xs text-gray-600">proposé à partir du {dateFormat.format(f.prochainRappel)}</span>
									{/if}
								</span>
							</td>
							<td class={td}>
								{#if f.to.length === 0}
									<span class="font-bold text-red-700">Aucune adresse email</span>
								{:else}
									<details>
										<summary class="cursor-pointer font-bold">{rang(f.niveau)} → {f.to.join(', ')}</summary>
										<p class="mt-2 text-xs font-bold">{f.subject}</p>
										<pre class="mt-1 border border-black bg-gray-100 p-3 text-xs whitespace-pre-wrap">{f.text}</pre>
									</details>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="mb-10 border border-black p-4">
				<div class="mb-4 flex flex-wrap gap-3 text-sm">
					<button type="button" class="underline" onclick={() => (selection = envoyables.filter((f) => f.aRelancer).map((f) => f.id))}>
						Cocher les factures à relancer ({envoyables.filter((f) => f.aRelancer).length})
					</button>
					<button type="button" class="underline" onclick={() => (selection = [])}>Tout décocher</button>
				</div>
				<label class="mb-1 block text-xs font-bold uppercase" for="complement">Message complémentaire (facultatif, ajouté à chaque rappel)</label>
				<textarea id="complement" name="complement" rows="3" maxlength="2000" bind:value={complement} class="mb-4 w-full border border-black px-3 py-2 text-sm"></textarea>
				<button type="submit" disabled={submitting || selection.length === 0 || !data.mailConfigured} class="btn-primary px-4 py-2 disabled:opacity-50">
					{submitting ? 'Envoi…' : `Envoyer ${selection.length} rappel(s) — ${amountFormat.format(totalSelection)}`}
				</button>
			</div>
		</form>
	{:else}
		<p class="mb-10 border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucune facture échue.</p>
	{/if}

	<h2 class={h2}>Rappels envoyés</h2>
	{#if data.rappels.length > 0}
		<table class="table-cards w-full border-collapse text-sm">
			<thead>
				<tr class="bg-black text-white uppercase">
					<th class={th}>Envoyé le</th>
					<th class={th}>Facture</th>
					<th class={th}>Client</th>
					<th class={th}>Rang</th>
					<th class="{th} text-right">Restait dû</th>
					<th class={th}>Destinataires</th>
					<th class={th}>Par</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rappels as r (r.id)}
					<tr>
						<td class={td} data-label="Envoyé le">{dateTimeFormat.format(r.envoyeLe)}</td>
						<td class={td} data-label="Facture"><a href="/compta/factures/{r.factureId}">{r.factureNumero}</a></td>
						<td class={td} data-label="Client">{r.tiersNom}</td>
						<td class={td} data-label="Rang">
							<details>
								<summary class="cursor-pointer">{rang(r.niveau)}</summary>
								<pre class="mt-1 border border-black bg-gray-100 p-3 text-left text-xs whitespace-pre-wrap">{r.message}</pre>
							</details>
						</td>
						<td class="{td} sm:text-right" data-label="Restait dû">{amountFormat.format(r.reste)}</td>
						<td class="{td} break-all" data-label="Destinataires">{r.envoyeA}</td>
						<td class={td} data-label="Par">{r.envoyePar}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">Aucun rappel envoyé.</p>
	{/if}
</section>
