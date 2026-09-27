<script lang="ts">
	import { showToast } from '$lib/stores/toast.svelte';
	import FactureForm from '$lib/components/compta/FactureForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) showToast('error', form.error);
	});

	const values = $derived(form?.values ?? (data.preselectedTiersId ? { tiersId: data.preselectedTiersId } : {}));
</script>

<svelte:head>
	<title>Nouvelle facture — Compta — Passport</title>
</svelte:head>

<section>
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<h1 class="bg-black px-4 py-3 text-base font-bold text-white uppercase">Nouvelle facture</h1>
		<a href="/compta/factures" class="text-sm">← Factures</a>
	</div>
	<p class="mb-4 text-sm text-gray-600">
		Une facture émise est créée en brouillon : elle reçoit son numéro et son PDF à la validation, depuis sa
		fiche. Une facture reçue est enregistrée telle quelle, avec le numéro du fournisseur.
	</p>
	<FactureForm action="?/create" tiers={data.tiers} {values} lignes={form?.lignes ?? []} submitLabel="Créer" />
</section>
