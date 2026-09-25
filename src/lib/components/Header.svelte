<script lang="ts">
	import type { AppUser } from '$lib/types';

	let {
		user,
		onOpenMenu
	}: {
		user: AppUser | null;
		onOpenMenu: () => void;
	} = $props();
</script>

<!-- Mobile only (below md) — desktop nav lives in Sidebar.svelte instead. Accueil/Trombinoscope/
     Wishlist and the cotisation badge used to also show here, but they're already in the menu
     overlay (name, avatar and cotisation status are right at its top), so keeping them here too
     was redundant. Menu button on the left, matching the drawer it opens sliding in from the
     left. -->
<header class="border-b-4 border-black md:hidden">
	<div class="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
		{#if user}
			<button
				type="button"
				onclick={onOpenMenu}
				aria-label="Ouvrir le menu"
				class="flex h-10 w-10 shrink-0 items-center justify-center transition-colors hover:bg-black hover:text-white"
			>
				<svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M3 5 H17 M3 10 H17 M3 15 H17" stroke-linecap="round" />
				</svg>
			</button>
		{/if}

		<a href="/" title="Passport" class="no-underline-fx block shrink-0">
			<img src="/logo.svg" alt="Liège Hackerspace" class="h-12 w-auto" />
		</a>

		{#if !user}
			<a
				href="/login"
				data-sveltekit-preload-data="off"
				class="no-underline-fx btn-primary ml-auto inline-block px-3 py-2"
			>
				Connexion
			</a>
		{/if}
	</div>
</header>
