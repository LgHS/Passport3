<script lang="ts">
	import { fly } from 'svelte/transition';
	import { dismissToast, getToast } from '$lib/stores/toast.svelte';

	let toast = $derived(getToast());
</script>

{#if toast}
	<div
		role="status"
		aria-live="polite"
		transition:fly={{ x: 40, duration: 200 }}
		class="fixed top-4 right-4 z-50 max-w-sm border-4 border-black px-4 py-3 shadow-[4px_4px_0_0_#000] {toast.type ===
		'success'
			? 'bg-lghs-yellow text-black'
			: 'bg-red-600 text-white'}"
	>
		<div class="flex items-start gap-3">
			<p class="flex-1 text-sm font-bold">{toast.message}</p>
			<button
				type="button"
				onclick={dismissToast}
				aria-label="Fermer"
				class="shrink-0 cursor-pointer text-sm font-bold"
			>
				✕
			</button>
		</div>
	</div>
{/if}
