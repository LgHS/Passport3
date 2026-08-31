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
	<div class="relative mx-auto max-w-5xl px-4 py-3 md:py-6">
		<!-- Desktop (md and up): untouched from the original — logo and nav share a single row,
		     cotisation badge pinned to the corner. Left exactly as it was; only mobile below needed
		     reworking. The switch point is md (768px), not sm (640px): at exactly 640-767px there
		     isn't quite enough room for logo + nav on one line, so the original flex-wrap here would
		     kick in and stack full-size elements — neither properly desktop nor the compact mobile
		     treatment below. Bumping the threshold to md keeps that dead zone on the mobile side. -->
		<div class="hidden flex-wrap items-center justify-between gap-4 md:flex">
			{#if cotisationStatus}
				<div class="absolute top-1 right-4 z-10">
					<CotisationTopbar status={cotisationStatus} />
				</div>
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
					<a
						href="/trombinoscope"
						class="no-underline-fx inline-block px-3 py-2 font-bold uppercase transition-colors hover:bg-black hover:text-white"
					>
						Trombinoscope
					</a>

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
									href="/permissions"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									Permissions
								</a>
								<a
									href="/cotisation"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									Cotisation
								</a>
								<a
									href="/badge"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									Badge
								</a>
								<a
									href="/github"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									GitHub
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
					<a
						href="/login"
						data-sveltekit-preload-data="off"
						class="no-underline-fx btn-primary inline-block px-3 py-2"
					>
						Connexion
					</a>
				{/if}
			</nav>
		</div>

		<!-- Below md only: tightened two-row layout — smaller logo, cotisation badge in normal flow
		     instead of absolute (would float disconnected once this wraps), "Mon compte" instead of
		     the full name so Accueil + Trombinoscope + the account button fit one line without
		     wrapping. -->
		<div class="md:hidden">
			<div class="flex items-center justify-between gap-4">
				<a href="/" title="Passport" class="no-underline-fx block shrink-0">
					<img src="/logo.svg" alt="Liège Hackerspace" class="h-10 w-auto" />
				</a>
				{#if cotisationStatus}
					<CotisationTopbar status={cotisationStatus} />
				{/if}
			</div>

			<nav class="mt-3 flex flex-nowrap items-center gap-1 text-sm">
				<a
					href="/"
					class="no-underline-fx inline-block px-2 py-2 font-bold uppercase transition-colors hover:bg-black hover:text-white"
				>
					Accueil
				</a>

				{#if user}
					<a
						href="/trombinoscope"
						class="no-underline-fx inline-block px-2 py-2 font-bold uppercase transition-colors hover:bg-black hover:text-white"
					>
						Trombinoscope
					</a>

					<div class="relative ml-auto" data-user-menu>
						<button
							type="button"
							onclick={() => (menuOpen = !menuOpen)}
							class="flex items-center gap-2 px-2 py-2 font-bold uppercase transition-colors hover:bg-black hover:text-white"
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
							Mon compte
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
									href="/permissions"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									Permissions
								</a>
								<a
									href="/cotisation"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									Cotisation
								</a>
								<a
									href="/badge"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									Badge
								</a>
								<a
									href="/github"
									role="menuitem"
									onclick={() => (menuOpen = false)}
									class="no-underline-fx menu-item"
								>
									GitHub
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
					<a
						href="/login"
						data-sveltekit-preload-data="off"
						class="no-underline-fx btn-primary ml-auto inline-block px-3 py-2"
					>
						Connexion
					</a>
				{/if}
			</nav>
		</div>
	</div>
</header>
