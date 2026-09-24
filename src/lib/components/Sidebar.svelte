<script lang="ts">
	import { page } from '$app/state';
	import {
		displayName,
		isAdmin,
		COTISATION_STATUS_LABEL,
		COTISATION_STATUS_COLOR,
		type AppUser,
		type CotisationStatus
	} from '$lib/types';
	import { avatarSize } from '$lib/avatar';

	let {
		user,
		avatarUrl,
		cotisationStatus,
		collapsed = $bindable(false)
	}: {
		user: AppUser | null;
		avatarUrl: string | null;
		cotisationStatus: CotisationStatus | null;
		collapsed?: boolean;
	} = $props();

	function initials(u: AppUser): string {
		return displayName(u)
			.trim()
			.split(/\s+/)
			.map((part) => part[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	// "/" only matches the exact homepage — every other item matches its own path and anything
	// nested under it (e.g. /admin/users/12 keeps "Admin" highlighted).
	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}

	const itemClass =
		'no-underline-fx flex items-center gap-3 rounded px-4 py-2.5 text-sm font-bold uppercase transition-colors';
	function itemStateClass(href: string): string {
		return isActive(href) ? 'bg-lghs-yellow text-black' : 'text-black hover:bg-gray-100';
	}

	const COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

	// `collapsed` is bindable so +layout.svelte can reserve top padding for the fixed logo on the
	// content column once <aside> is hidden (it takes zero width then, so the content column
	// would otherwise render underneath the logo). Defaults to expanded on every render, including
	// the very first client-side one — reading localStorage during initialization would break
	// server-side rendering (no `localStorage` there). $effect only runs client-side after mount,
	// so this corrects it right after, before the user has a chance to see it flash open on a
	// device where they'd left it collapsed.
	$effect(() => {
		try {
			collapsed = localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
		} catch {
			// Private browsing / storage disabled — just keep the default (expanded).
		}
	});

	function toggleCollapsed() {
		collapsed = !collapsed;
		try {
			localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
		} catch {
			// Per-viewer convenience only — nothing breaks if this can't be remembered.
		}
	}
</script>

<!-- Desktop only (md+) — the mobile top bar in Header.svelte covers the same destinations in its
     own dropdown, unchanged. Rocket.Chat-inspired in structure only (fixed sidebar, flat list, one
     icon + label per row, active item highlighted solid) — not in color: the rest of Passport3 is
     white background/black text/yellow accent, never a solid dark panel, and the logo itself is
     pure black (`fill="#000"`, unusable on a dark background), so this follows that same palette
     rather than Rocket.Chat's own dark theme.

     Deliberately light on rules: a single hairline on the right edge separates it from the main
     content, everything inside is spaced with padding rather than a horizontal rule per section —
     the rest of the app already uses bold 4px borders generously, and repeating that treatment for
     every section of a tall, skinny column read as too heavy here.

     The parent row (`+layout.svelte`) is now a fixed-height flex row with `overflow-hidden` —
     the sidebar and the content column each get their own independent scroll region instead of
     the whole page scrolling as one unit (Rocket.Chat/Mattermost-style). `h-full` lets this
     stretch to match that row's height (an earlier version fought that same stretching behavior
     back when the parent scrolled as a whole page — now it's exactly what's wanted), and its own
     `overflow-y-auto` scrolls the nav internally if it's ever taller than the viewport, without
     affecting the content column's scroll.

     The logo itself is `fixed` and rendered here just once, entirely outside `<aside>`, always at
     the same spot regardless of `collapsed` — an earlier version duplicated it (once inside the
     aside, once in a separate collapsed-only block tuned by eye to roughly line up) and it still
     visibly jumped by a pixel or two on toggle. One element that never moves is the only way to
     truly guarantee that; `<aside>` below reserves matching space at its own top (`pt-28`) instead
     of rendering its own copy. -->
<a href="/" class="no-underline-fx fixed top-6 left-0 z-20 hidden w-56 items-center justify-center px-4 md:flex">
	<img src="/logo.svg" alt="Liège Hackerspace" class="h-16 w-auto" />
</a>

<aside
	class="h-full w-56 shrink-0 flex-col border-r border-gray-200 bg-white pt-28 {collapsed
		? 'hidden'
		: 'hidden md:flex'}"
>
	{#if user}
		<div class="mb-6 flex shrink-0 items-center gap-2 px-4">
			{#if avatarUrl}
				<img src={avatarSize(avatarUrl, 64)} alt="" class="h-8 w-8 shrink-0 rounded-full object-cover" />
			{:else}
				<span
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-sm font-bold text-white"
				>
					{initials(user)}
				</span>
			{/if}
			<div class="min-w-0">
				<p class="truncate text-sm font-bold text-black">{displayName(user)}</p>
				{#if cotisationStatus}
					<a
						href="/cotisation"
						class="no-underline-fx flex items-center gap-1.5 text-xs text-gray-600 hover:text-black"
					>
						<span
							class="inline-block h-2 w-2 shrink-0 rounded-full"
							style="background-color: {COTISATION_STATUS_COLOR[cotisationStatus]};"
							aria-hidden="true"
						></span>
						{COTISATION_STATUS_LABEL[cotisationStatus]}
					</a>
				{/if}
			</div>
		</div>

		<nav class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
			<a href="/" class="{itemClass} {itemStateClass('/')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M3 10 L10 3.5 L17 10" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M5 8.5 V17 H15 V8.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				Accueil
			</a>
			<a href="/trombinoscope" class="{itemClass} {itemStateClass('/trombinoscope')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="7" cy="7" r="2.5" />
					<path d="M2.5 16c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" stroke-linecap="round" />
					<circle cx="14" cy="7.5" r="2" />
					<path d="M11.5 12c1-.7 2-1 2.5-1 2 0 3.5 1.5 3.5 4" stroke-linecap="round" />
				</svg>
				Trombinoscope
			</a>
			<a href="/wishlist" class="{itemClass} {itemStateClass('/wishlist')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<rect x="3" y="8.5" width="14" height="8" rx="1" />
					<path d="M3 8.5 L17 8.5" />
					<path d="M10 8.5 V17" />
					<path
						d="M10 8.5C10 8.5 7 8.5 6.3 6.8C5.8 5.6 6.6 4.5 7.7 4.5C9 4.5 10 6 10 8.5Z"
						stroke-linejoin="round"
					/>
					<path
						d="M10 8.5C10 8.5 13 8.5 13.7 6.8C14.2 5.6 13.4 4.5 12.3 4.5C11 4.5 10 6 10 8.5Z"
						stroke-linejoin="round"
					/>
				</svg>
				Wishlist
			</a>
			<a href="/profile" class="{itemClass} {itemStateClass('/profile')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="10" cy="6.5" r="3" />
					<path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke-linecap="round" />
				</svg>
				Mon profil
			</a>
			<a href="/permissions" class="{itemClass} {itemStateClass('/permissions')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<path
						d="M10 2.5 L16.5 5 V10 C16.5 13.8 13.8 16.7 10 17.5 C6.2 16.7 3.5 13.8 3.5 10 V5 Z"
						stroke-linejoin="round"
					/>
				</svg>
				Permissions
			</a>
			<a href="/cotisation" class="{itemClass} {itemStateClass('/cotisation')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<rect x="2.5" y="5" width="15" height="10" rx="1.2" />
					<path d="M2.5 8.5 H17.5" />
				</svg>
				Cotisation
			</a>
			<a href="/badge" class="{itemClass} {itemStateClass('/badge')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<rect x="5" y="2" width="10" height="16" rx="2" />
					<circle cx="10" cy="7.5" r="2" />
					<path d="M7.5 13 H12.5 M7.5 15 H12.5" stroke-linecap="round" />
				</svg>
				Badge
			</a>
			<a href="/github" class="{itemClass} {itemStateClass('/github')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="6" cy="14.5" r="2" />
					<circle cx="14" cy="5.5" r="2" />
					<circle cx="6" cy="5.5" r="2" />
					<path d="M6 7.5 V12.5" />
					<path d="M8 14.5 H10 C12.2 14.5 14 12.7 14 10.5 V7.5" stroke-linecap="round" />
				</svg>
				GitHub
			</a>

			{#if isAdmin(user)}
				<a href="/admin" class="{itemClass} {itemStateClass('/admin')} mt-4">
					<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
						<circle cx="10" cy="10" r="2.5" />
						<path
							d="M10 3.5 V5.5 M10 14.5 V16.5 M3.5 10 H5.5 M14.5 10 H16.5 M5.6 5.6 L7 7 M13 13 L14.4 14.4 M5.6 14.4 L7 13 M13 7 L14.4 5.6"
							stroke-linecap="round"
						/>
					</svg>
					Admin
				</a>
			{/if}
		</nav>

		<form method="POST" action="/logout" class="mt-6 mb-6 shrink-0 px-2">
			<button
				type="submit"
				class="{itemClass} w-full cursor-pointer text-gray-600 hover:bg-gray-100 hover:text-black"
			>
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M8 3.5 H4.5 V16.5 H8" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M8.5 10 H16.5 M16.5 10 L13.5 7 M16.5 10 L13.5 13" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				Se déconnecter
			</button>
		</form>
	{:else}
		<a
			href="/login"
			data-sveltekit-preload-data="off"
			class="no-underline-fx btn-primary mx-4 block px-4 py-2 text-center"
		>
			Connexion
		</a>
	{/if}
</aside>

<!-- Stays visible regardless of `collapsed` (it lives outside the <aside> it controls) so there's
     always a way back — sits just past the sidebar's right edge when open, or near the page's own
     left edge once collapsed, VS Code-style. Vertically centered on the viewport rather than
     pinned near the top, so it doesn't get lost right next to the logo. Desktop only, same as the
     sidebar itself. A stronger black border (rather than the initial light gray) makes it read as
     clickable on its own instead of disappearing against the white page; the "Menu" label only
     shows on hover while collapsed, since there's nothing else on screen at that point to say
     what the button does. -->

{#if user}
	<button
		type="button"
		onclick={toggleCollapsed}
		aria-label={collapsed ? 'Afficher le menu' : 'Masquer le menu'}
		title={collapsed ? 'Afficher le menu' : 'Masquer le menu'}
		class="group fixed top-24 z-20 hidden h-8 w-8 items-center justify-center rounded-full border-2 border-black bg-white text-black shadow-sm transition-[left] hover:bg-black hover:text-white md:flex"
		style="left: {collapsed ? '0.5rem' : '13rem'}"
	>
		<svg
			viewBox="0 0 20 20"
			class="h-4 w-4 shrink-0 transition-transform {collapsed ? 'rotate-180' : ''}"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		>
			<path d="M12.5 4 L6.5 10 L12.5 16" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
		{#if collapsed}
			<span
				class="no-underline-fx pointer-events-none absolute left-full ml-2 rounded border border-black bg-white px-2 py-1 text-xs font-bold uppercase text-black opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
			>
				Menu
			</span>
		{/if}
	</button>
{/if}
