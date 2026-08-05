<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Seeded once from the load — deliberately not kept in sync with `data.uuid` afterwards,
	// since regenerating below updates this local copy directly (front-end shell, no backend yet).
	// svelte-ignore state_referenced_locally
	let uuid = $state(data.uuid);
	let showUuid = $state(false);
	let showConfirm = $state(false);
	let understood = $state(false);
	let regenSuccess = $state(false);

	function startRegen() {
		showConfirm = true;
		understood = false;
		regenSuccess = false;
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
		regenSuccess = true;
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
		<div class="flex items-center gap-2 border border-black bg-gray-100 px-3 py-2">
			<p class="flex-1 font-mono text-sm">{showUuid ? uuid : '•'.repeat(uuid.length)}</p>
			<button
				type="button"
				onclick={() => (showUuid = !showUuid)}
				aria-label={showUuid ? "Masquer l'identifiant" : "Afficher l'identifiant"}
				title={showUuid ? "Masquer l'identifiant" : "Afficher l'identifiant"}
				class="shrink-0 text-gray-600 hover:text-black"
			>
				{#if showUuid}
					<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5">
						<path
							d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<circle cx="10" cy="10" r="2.25" />
					</svg>
				{:else}
					<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5">
						<path
							d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<circle cx="10" cy="10" r="2.25" />
						<line x1="2" y1="17" x2="18" y2="3" stroke-linecap="round" />
					</svg>
				{/if}
			</button>
		</div>
	</div>

	{#if regenSuccess}
		<p class="mb-6 border-4 border-black bg-lghs-yellow px-4 py-3 font-bold">
			Votre (vos) badge(s) a (ont) été régénéré(s).
		</p>
	{/if}

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
					En régénérant votre UUID, votre (vos) badge(s) actuel(s) cessera(ont) de fonctionner
					immédiatement. Cette opération ne doit être utilisée qu'en cas de perte ou de copie de
					votre (vos) badge(s).
				</p>
				<label class="mb-4 flex items-start gap-2 text-sm">
					<input type="checkbox" bind:checked={understood} class="mt-1" />
					J'ai compris que mon (mes) badge(s) actuel(s) ne fonctionnera(ont) plus.
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
