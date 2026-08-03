<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Seeded once from the load — deliberately not kept in sync with `data.uuid` afterwards,
	// since regenerating below updates this local copy directly (front-end shell, no backend yet).
	// svelte-ignore state_referenced_locally
	let uuid = $state(data.uuid);
	let showConfirm = $state(false);
	let understood = $state(false);

	function startRegen() {
		showConfirm = true;
		understood = false;
	}

	function cancelRegen() {
		showConfirm = false;
		understood = false;
	}

	function confirmRegen() {
		// TODO: call the backend that actually reissues the badge once it exists — this only
		// simulates it client-side for now (front-end shell, per plan).
		uuid = crypto.randomUUID();
		showConfirm = false;
		understood = false;
	}
</script>

<svelte:head>
	<title>Badge RFID — Passport</title>
</svelte:head>

<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">Badge RFID</h1>

<section class="max-w-2xl">
	<p class="mb-2 text-sm leading-relaxed">
		Cet identifiant unique sert à sécuriser votre porte-clé ou votre carte d'accès RFID au
		hackerspace.
	</p>
	<p class="mb-2 text-sm leading-relaxed">
		Cet identifiant est confidentiel et ne doit pas être communiqué à n'importe qui.
	</p>
	<p class="mb-6 text-sm leading-relaxed">
		Il est possible de le régénérer en cas de doute, de copie ou de perte.
	</p>

	<div class="mb-6">
		<span class="mb-1 block text-sm font-bold uppercase">Identifiant (UUID)</span>
		<p class="border border-black bg-gray-100 px-3 py-2 font-mono text-sm">{uuid}</p>
	</div>

	{#if !showConfirm}
		<button type="button" onclick={startRegen} class="btn-primary px-4 py-2">
			Régénérer mon UUID
		</button>
	{:else}
		<div class="border-4 border-black">
			<div class="hazard-stripes h-2"></div>
			<div class="p-6">
				<p class="mb-3 text-sm font-bold uppercase">Attention, action irréversible</p>
				<p class="mb-4 text-sm leading-relaxed">
					En régénérant votre UUID, votre badge actuel cessera de fonctionner immédiatement. Cette
					opération ne doit être utilisée qu'en cas de perte ou de copie de votre badge.
				</p>
				<label class="mb-4 flex items-start gap-2 text-sm">
					<input type="checkbox" bind:checked={understood} class="mt-1" />
					J'ai compris que mon badge actuel ne fonctionnera plus.
				</label>
				<div class="flex gap-3 pb-1">
					<button
						type="button"
						onclick={confirmRegen}
						disabled={!understood}
						class="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-40"
					>
						Confirmer la régénération
					</button>
					<button
						type="button"
						onclick={cancelRegen}
						class="px-4 py-2 text-sm font-bold uppercase transition-colors hover:bg-black hover:text-white"
					>
						Annuler
					</button>
				</div>
			</div>
			<div class="hazard-stripes h-2"></div>
		</div>
	{/if}
</section>
