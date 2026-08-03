<script lang="ts">
	import { displayName, isAdmin, type AppUser, type CotisationStatus } from '$lib/types';
	import CotisationTopbar from '$lib/components/CotisationTopbar.svelte';

	let {
		user,
		avatarUrl,
		cotisationStatus
	}: { user: AppUser | null; avatarUrl: string | null; cotisationStatus: CotisationStatus | null } =
		$props();

	let menuOpen = $state(false);

	function initials(u: AppUser): string {
		return displayName(u)
			.trim()
			.split(/\s+/)
			.map((part) => part[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	function handleWindowClick(event: MouseEvent) {
		if (!(event.target as HTMLElement).closest('[data-user-menu]')) {
			menuOpen = false;
		}
	}
</script>

<svelte:window onclick={handleWindowClick} />

<header class="border-b-4 border-black">
	<div class="relative mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-6">
		{#if cotisationStatus}
			<CotisationTopbar status={cotisationStatus} />
		{/if}
		<a href="/" title="Passport" class="no-underline-fx block">
			<img src="/logo.svg" alt="Liège Hackerspace" class="h-16 w-auto" />
		</a>

		<nav class="flex flex-wrap items-center gap-1 text-sm">
			<a
				href="/"
				class="no-underline-fx inline-block px-3 py-2 font-bold uppercase transition-colors hover:bg-black hover:text-white"
			>
				Accueil
			</a>

			{#if user}
				<div class="relative" data-user-menu>
					<button
						type="button"
						onclick={() => (menuOpen = !menuOpen)}
						class="flex items-center gap-2 px-3 py-2 font-bold uppercase transition-colors hover:bg-black hover:text-white"
						aria-expanded={menuOpen}
						aria-haspopup="menu"
					>
						{#if avatarUrl}
							<img src={avatarUrl} alt="" class="h-8 w-8 object-cover" />
						{:else}
							<span class="flex h-8 w-8 items-center justify-center bg-black text-sm text-white">
								{initials(user)}
							</span>
						{/if}
						{displayName(user)}
						<svg
							viewBox="0 0 12 8"
							class="h-2.5 w-2.5 fill-current transition-transform {menuOpen ? 'rotate-180' : ''}"
							aria-hidden="true"
						>
							<path d="M0 0 L12 0 L6 8 Z" />
						</svg>
					</button>

					{#if menuOpen}
						<div
							role="menu"
							class="absolute right-0 z-10 mt-1 w-48 border-4 border-black bg-white text-black"
						>
							<a
								href="/profile"
								role="menuitem"
								onclick={() => (menuOpen = false)}
								class="no-underline-fx menu-item"
							>
								Mon profil
							</a>
							<a
								href="/cotisation"
								role="menuitem"
								onclick={() => (menuOpen = false)}
								class="no-underline-fx menu-item"
							>
								Cotisation
							</a>
							{#if isAdmin(user)}
								<a
									href="/admin"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									Admin
								</a>
							{/if}
							<form method="POST" action="/logout">
								<!-- No onclick to close the menu here: closing it removes this form from
								     the DOM synchronously, which cancels the native submit before it fires.
								     Not needed anyway since a full page navigation follows logout. -->
								<button
									type="submit"
									role="menuitem"
									class="menu-item w-full cursor-pointer text-left"
								>
									Se déconnecter
								</button>
							</form>
						</div>
					{/if}
				</div>
			{:else}
				<a href="/login" class="no-underline-fx btn-primary inline-block px-3 py-2"> Connexion </a>
			{/if}
		</nav>
	</div>
</header>
