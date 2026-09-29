<script lang="ts">
	import { page } from '$app/state';
	import { fade, fly, slide } from 'svelte/transition';
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
		collapsed = $bindable(false),
		overlayOpen = $bindable(false)
	}: {
		user: AppUser | null;
		avatarUrl: string | null;
		cotisationStatus: CotisationStatus | null;
		collapsed?: boolean;
		overlayOpen?: boolean;
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
		'no-underline-fx flex items-center gap-3 rounded px-4 py-1.5 text-sm font-bold uppercase transition-colors';
	// Small grey heading above a group of entries ("Mon compte", "Hackerspace", "Sécurité", "Admin"); the
	// foldable ones are buttons with the same look.
	const sectionLabelClass = 'mt-3 mb-0.5 px-4 text-xs font-bold tracking-wide text-gray-500 uppercase';
	function itemStateClass(href: string, active = isActive(href)): string {
		return active ? 'bg-lghs-yellow text-black' : 'text-black hover:bg-gray-100';
	}
	// "Membres" is /admin itself and the member pages under it (/admin/users/…, /admin/invite),
	// not every /admin/* page — Paramètres, Incidents and Audit have their own entries.
	const membersActive = $derived(
		page.url.pathname === '/admin' ||
			page.url.pathname.startsWith('/admin/users') ||
			page.url.pathname.startsWith('/admin/invite')
	);

	// Foldable menu sections, open by default. Only the ones a member closed are remembered, per
	// browser (same convenience-only storage as the collapsed sidebar below). Sécurité isn't one of
	// them: Incidents must always be one glance away.
	const SECTIONS_STORAGE_KEY = 'sidebar-closed-sections';
	const SECTION_PATHS: Record<string, string[]> = {
		account: ['/profile', '/cotisation', '/badge', '/permissions', '/github'],
		hackerspace: ['/trombinoscope', '/tasks', '/wishlist'],
		admin: ['/admin']
	};
	let closedSections = $state<Record<string, boolean>>({});

	$effect(() => {
		try {
			closedSections = JSON.parse(localStorage.getItem(SECTIONS_STORAGE_KEY) ?? '{}');
		} catch {
			// Unreadable or unavailable — everything stays open.
		}
	});

	// Landing on a page (e.g. from a link) inside a closed section opens it, so the current page is
	// never hidden in the menu.
	$effect(() => {
		for (const [id, paths] of Object.entries(SECTION_PATHS)) {
			if (closedSections[id] && paths.some(isActive)) toggleSection(id);
		}
	});

	// A light slide when a section folds or unfolds; none for people who asked their system for
	// reduced motion. Svelte transitions are local, so navigating between pages doesn't trigger it.
	let foldDuration = $state(150);
	$effect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) foldDuration = 0;
	});

	function toggleSection(id: string) {
		closedSections = { ...closedSections, [id]: !closedSections[id] };
		try {
			localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(closedSections));
		} catch {
			// Per-viewer convenience only.
		}
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

	// Desktop collapse/expand always toggles the permanent pushed sidebar, regardless of screen
	// size — the temporary overlay drawer is a separate, mobile-only mechanism (Header.svelte's
	// menu button, gated to below `md` there). An earlier version made this button open the
	// overlay instead of restoring the permanent sidebar once collapsed, which meant a wide
	// desktop screen with plenty of room to spare still got the mobile-style overlay — wrong on a
	// large screen where there's no reason not to just bring the permanent sidebar back.
	function toggleCollapsed() {
		collapsed = !collapsed;
		try {
			localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
		} catch {
			// Per-viewer convenience only — nothing breaks if this can't be remembered.
		}
	}

	function closeOverlay() {
		overlayOpen = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && overlayOpen) {
			closeOverlay();
		}
	}

	// Moves focus onto the drawer's own close button as soon as it opens, so keyboard users land
	// somewhere inside it instead of on whatever was focused on the page underneath.
	let closeButtonEl = $state<HTMLButtonElement | null>(null);
	$effect(() => {
		if (overlayOpen) {
			closeButtonEl?.focus();
		}
	});
</script>

<!-- Heading of a foldable menu section: the label and a chevron, pointing right once folded. -->
{#snippet foldHeader(id: string, label: string)}
	<button
		type="button"
		onclick={() => toggleSection(id)}
		aria-expanded={!closedSections[id]}
		class="{sectionLabelClass} flex w-full cursor-pointer items-center justify-between hover:text-black"
	>
		{label}
		<svg
			viewBox="0 0 20 20"
			class="h-3 w-3 transition-transform {closedSections[id] ? '-rotate-90' : ''}"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path d="M5 7.5 L10 12.5 L15 7.5" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>
{/snippet}

<svelte:window onkeydown={handleKeydown} />

<!-- The identity block + nav list + logout are identical between the permanent desktop sidebar
     and the temporary overlay drawer (mobile, or desktop while collapsed) — shared here as a
     snippet instead of duplicating the markup in both places. -->
{#snippet sidebarNav()}
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
						onclick={closeOverlay}
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
			<a href="/" onclick={closeOverlay} class="{itemClass} {itemStateClass('/')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M3 10 L10 3.5 L17 10" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M5 8.5 V17 H15 V8.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				Accueil
			</a>
			{@render foldHeader('account', 'Mon compte')}
			{#if !closedSections.account}
				<div class="flex flex-col gap-0.5" transition:slide={{ duration: foldDuration }}>
					<a href="/profile" onclick={closeOverlay} class="{itemClass} {itemStateClass('/profile')}">
						<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
							<circle cx="10" cy="6.5" r="3" />
							<path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke-linecap="round" />
						</svg>
						Mon profil
					</a>
					<a href="/cotisation" onclick={closeOverlay} class="{itemClass} {itemStateClass('/cotisation')}">
						<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
							<rect x="2.5" y="5" width="15" height="10" rx="1.2" />
							<path d="M2.5 8.5 H17.5" />
						</svg>
						Cotisation
					</a>
					<a href="/badge" onclick={closeOverlay} class="{itemClass} {itemStateClass('/badge')}">
						<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
							<rect x="5" y="2" width="10" height="16" rx="2" />
							<circle cx="10" cy="7.5" r="2" />
							<path d="M7.5 13 H12.5 M7.5 15 H12.5" stroke-linecap="round" />
						</svg>
						Badge RFID
					</a>
					<a href="/permissions" onclick={closeOverlay} class="{itemClass} {itemStateClass('/permissions')}">
						<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
							<path
								d="M10 2.5 L16.5 5 V10 C16.5 13.8 13.8 16.7 10 17.5 C6.2 16.7 3.5 13.8 3.5 10 V5 Z"
								stroke-linejoin="round"
							/>
						</svg>
						Permissions
					</a>
					<a href="/github" onclick={closeOverlay} class="{itemClass} {itemStateClass('/github')}">
						<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
							<circle cx="6" cy="14.5" r="2" />
							<circle cx="14" cy="5.5" r="2" />
							<circle cx="6" cy="5.5" r="2" />
							<path d="M6 7.5 V12.5" />
							<path d="M8 14.5 H10 C12.2 14.5 14 12.7 14 10.5 V7.5" stroke-linecap="round" />
						</svg>
						GitHub
					</a>
				</div>
			{/if}
			{@render foldHeader('hackerspace', 'Hackerspace')}
			{#if !closedSections.hackerspace}
				<div class="flex flex-col gap-0.5" transition:slide={{ duration: foldDuration }}>
					<a href="/trombinoscope" onclick={closeOverlay} class="{itemClass} {itemStateClass('/trombinoscope')}">
						<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
							<circle cx="7" cy="7" r="2.5" />
							<path d="M2.5 16c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" stroke-linecap="round" />
							<circle cx="14" cy="7.5" r="2" />
							<path d="M11.5 12c1-.7 2-1 2.5-1 2 0 3.5 1.5 3.5 4" stroke-linecap="round" />
						</svg>
						Trombinoscope
					</a>
					<a href="/tasks" onclick={closeOverlay} class="{itemClass} {itemStateClass('/tasks')}">
						<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
							<rect x="3.5" y="3.5" width="13" height="13" rx="1" />
							<path d="M6.5 10l2.5 2.5 4.5-5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						Tâches
					</a>
					<a href="/wishlist" onclick={closeOverlay} class="{itemClass} {itemStateClass('/wishlist')}">
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
				</div>
			{/if}
			<p class="{sectionLabelClass}">Sécurité</p>
			<a href="/incidents" onclick={closeOverlay} class="{itemClass} {itemStateClass('/incidents')}">
				<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M10 3.5 L18 16.5 H2 Z" stroke-linejoin="round" />
					<path d="M10 8 V11.5" stroke-linecap="round" />
					<path d="M10 14 V14.01" stroke-linecap="round" />
				</svg>
				Incidents
			</a>

			{#if isAdmin(user)}
				{@render foldHeader('admin', 'Admin')}
				{#if !closedSections.admin}
					<div class="flex flex-col gap-0.5" transition:slide={{ duration: foldDuration }}>
						<a href="/admin" onclick={closeOverlay} class="{itemClass} {itemStateClass('/admin', membersActive)}">
							<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="7" r="2.5" /><path d="M3.5 16c0-2.6 2-4.5 4.5-4.5s4.5 1.9 4.5 4.5" stroke-linecap="round" /><path d="M13 5.5 H17 M13 8.5 H17 M14.5 11.5 H17" stroke-linecap="round" /></svg>
							Membres
						</a>
						<a href="/admin/settings" onclick={closeOverlay} class="{itemClass} {itemStateClass('/admin/settings')}">
							<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="2.5" /><path d="M10 3.5 V5.5 M10 14.5 V16.5 M3.5 10 H5.5 M14.5 10 H16.5 M5.6 5.6 L7 7 M13 13 L14.4 14.4 M5.6 14.4 L7 13 M13 7 L14.4 5.6" stroke-linecap="round" /></svg>
							Paramètres
						</a>
						<a href="/admin/incidents" onclick={closeOverlay} class="{itemClass} {itemStateClass('/admin/incidents')}">
							<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.5" y="3.5" width="11" height="13" rx="1" /><path d="M7.5 7.5 H12.5 M7.5 10.5 H12.5 M7.5 13.5 H10.5" stroke-linecap="round" /></svg>
							Incidents
						</a>
						<a href="/admin/audit" onclick={closeOverlay} class="{itemClass} {itemStateClass('/admin/audit')}">
							<svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5 V10 L12.5 11.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
							Audit
						</a>
					</div>
				{/if}
			{/if}
		</nav>

		<form method="POST" action="/logout" class="mt-6 mb-6 shrink-0 px-2">
			<button
				type="submit"
				onclick={closeOverlay}
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
{/snippet}

<!-- Desktop only (md+) — the permanent, pushed sidebar. Rocket.Chat-inspired in structure only
     (fixed sidebar, flat list, one icon + label per row, active item highlighted solid) — not in
     color: the rest of Passport3 is white background/black text/yellow accent, never a solid dark
     panel, and the logo itself is pure black (`fill="#000"`, unusable on a dark background), so
     this follows that same palette rather than Rocket.Chat's own dark theme.

     Deliberately light on rules: a single hairline on the right edge separates it from the main
     content, everything inside is spaced with padding rather than a horizontal rule per section —
     the rest of the app already uses bold 4px borders generously, and repeating that treatment for
     every section of a tall, skinny column read as too heavy here.

     The parent row (`+layout.svelte`) is a fixed-height flex row with `overflow-hidden` — the
     sidebar and the content column each get their own independent scroll region instead of the
     whole page scrolling as one unit. `h-full` lets this stretch to match that row's height, and
     the nav's own `overflow-y-auto` scrolls it internally if it's ever taller than the viewport,
     without affecting the content column's scroll.

     The logo lives inside `<aside>` itself (normal flow, not `fixed`) — an earlier version kept
     it as a separate always-visible fixed element outside <aside> so it stayed reachable even
     while collapsed, but that meant reserving matching space on the content column whenever the
     sidebar collapsed (it otherwise rendered behind the fixed logo), and how much space was safe
     to reserve depended on viewport width, since a wide screen's centered content already clears
     the logo on its own. Simpler to just let the logo disappear along with the rest of the menu
     when collapsed — the toggle button (bottom of this file) stays reachable to bring it back.

     Collapsing animates the width down to 0 rather than toggling `display: none` — `display`
     can't be transitioned, so an instant hide/show was the only option before. `overflow-hidden`
     clips the (still w-56-wide) content during that shrink instead of letting it spill out or
     reflow; `hidden md:flex` still fully removes it on mobile, unrelated to this animation. -->
<aside
	class="hidden h-full shrink-0 flex-col overflow-hidden border-r bg-white transition-[width] duration-200 md:flex {collapsed
		? 'w-0 border-transparent'
		: 'w-56 border-gray-200'}"
>
	<!-- Fixed at w-56 regardless of the parent <aside>'s own animated width — otherwise this
	     content would reflow/wrap onto itself while the parent shrinks, instead of the parent
	     simply clipping a constant-width column as intended. -->
	<div class="flex h-full w-56 shrink-0 flex-col">
		<a href="/" class="no-underline-fx mb-6 flex shrink-0 items-center justify-center px-4 pt-6">
			<img src="/logo.svg" alt="Liège Hackerspace" class="h-16 w-auto" />
		</a>
		{@render sidebarNav()}
	</div>
</aside>

<!-- Temporary overlay drawer — mobile only, opened by Header.svelte's menu button
     (bind:overlayOpen, shared instead of Header keeping its own separate dropdown). The desktop
     collapse toggle below never opens this; it always toggles the permanent sidebar, regardless
     of how wide the screen is. Rocket.Chat-style: slides in over the content with a dark
     backdrop, rather than pushing it, since there's no room to permanently reserve on mobile.
     Closes on backdrop click, on any nav link/logout click (this layout persists across
     client-side navigation, so those need their own `onclick` rather than relying on the drawer
     unmounting), the close button in the drawer's own header, or Escape — which also receives
     focus as soon as the drawer opens, so keyboard users land inside it. -->
{#if overlayOpen}
	<div
		class="fixed inset-0 z-30 bg-black/50"
		onclick={closeOverlay}
		role="presentation"
		transition:fade={{ duration: 150 }}
	></div>
	<aside
		class="fixed inset-y-0 left-0 z-30 flex w-[80%] max-w-xs flex-col bg-white pt-6 pb-6 shadow-lg"
		transition:fly={{ x: -300, duration: 200 }}
	>
		<div class="mb-2 flex items-center justify-between px-4">
			<a href="/" class="no-underline-fx block" onclick={closeOverlay}>
				<img src="/logo.svg" alt="Liège Hackerspace" class="h-10 w-auto" />
			</a>
			<button
				bind:this={closeButtonEl}
				type="button"
				onclick={closeOverlay}
				aria-label="Fermer le menu"
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-black text-black hover:bg-black hover:text-white"
			>
				<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M5 5 L15 15 M15 5 L5 15" stroke-linecap="round" />
				</svg>
			</button>
		</div>
		{@render sidebarNav()}
	</aside>
{/if}

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
		class="group fixed top-24 z-20 hidden h-8 w-8 items-center justify-center rounded-full border-2 border-black bg-white text-black shadow-sm transition-[left] duration-200 hover:bg-black hover:text-white md:flex"
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
