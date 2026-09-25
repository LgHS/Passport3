<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import { avatarSize } from '$lib/avatar';
	import type { ActionData, PageData } from './$types';
	import ProfileForm from '$lib/components/ProfileForm.svelte';
	import EmergencyContactsForm from '$lib/components/EmergencyContactsForm.svelte';
	import { TAG_COLOR_PRESETS } from '$lib/tagColors';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Collapsed by default — this page has grown to profile form + 4 more sections, accordion
	// keeps it scannable instead of one long scroll.
	let optinSectionOpen = $state(false);
	let tagSectionOpen = $state(false);
	let permissionsSectionOpen = $state(false);
	let emergencyContactsSectionOpen = $state(false);
	let rfidSectionOpen = $state(false);

	let submittingOptin = $state(false);

	// Seeded once from the load/form result — same rationale as the badge UUID / cotisation IBAN
	// fields: the form owns its values once the admin starts toggling, not kept in sync afterwards.
	// svelte-ignore state_referenced_locally
	let visible = $state(form?.optin?.visible ?? data.optin.visible);

	const fieldOptins: { key: keyof typeof fieldOptinState; label: string }[] = [
		{ key: 'showAvatar', label: 'Avatar' },
		{ key: 'showChat', label: 'Pseudo Chat' },
		{ key: 'showFirstname', label: 'Prénom' },
		{ key: 'showLastname', label: 'Nom' },
		{ key: 'showMail', label: 'Mail' },
		{ key: 'showPhone', label: 'Téléphone' }
	];
	// svelte-ignore state_referenced_locally
	let fieldOptinState = $state({
		showAvatar: form?.optin?.showAvatar ?? data.optin.showAvatar,
		showChat: form?.optin?.showChat ?? data.optin.showChat,
		showFirstname: form?.optin?.showFirstname ?? data.optin.showFirstname,
		showLastname: form?.optin?.showLastname ?? data.optin.showLastname,
		showMail: form?.optin?.showMail ?? data.optin.showMail,
		showPhone: form?.optin?.showPhone ?? data.optin.showPhone
	});

	// Not part of fieldOptinState/fieldOptins above: free text, not a boolean toggle — same
	// pattern as the member-facing /trombinoscope form.
	// svelte-ignore state_referenced_locally
	let trombiEmailValue = $state(form?.optin?.trombiEmail ?? data.optin.trombiEmail);

	$effect(() => {
		if (form?.optinSuccess) {
			showToast('success', 'Visibilité trombinoscope mise à jour.');
		} else if (form?.optinError) {
			showToast('error', form.optinError);
			// Collapsed by default — an error would otherwise be invisible behind the accordion.
			optinSectionOpen = true;
		}
	});

	let submittingTag = $state(false);

	// svelte-ignore state_referenced_locally
	let tagValue = $state(form?.tag ?? data.tag.tag ?? '');
	// svelte-ignore state_referenced_locally
	let tagColorValue = $state(form?.tagColor ?? data.tag.tagColor ?? '');
	// Live preview swatch — falls back to the trombinoscope's default black badge (see
	// authentikAdmin.ts's HEX_COLOR_RE comment) when left empty or not yet valid.
	let tagColorPreview = $derived(/^[0-9a-fA-F]{6}$/.test(tagColorValue) ? `#${tagColorValue}` : '#000000');

	// Quick-pick shortcuts for the colors used most often — just fills the field, still editable
	// or overridable afterwards like any other value.
	const tagColorPresets = TAG_COLOR_PRESETS;

	$effect(() => {
		if (form?.tagSuccess) {
			showToast('success', 'Rôle mis à jour.');
		} else if (form?.tagError) {
			showToast('error', form.tagError);
			tagSectionOpen = true;
		}
	});

	// EmergencyContactsForm handles its own success/error toast internally — this just makes sure
	// the collapsed accordion section opens so a returned error is actually visible.
	$effect(() => {
		if (form?.emergencyContactsError) {
			emergencyContactsSectionOpen = true;
		}
	});

	let submittingRfid = $state(false);
	let rfidUnderstood = $state(false);
	let showRfidUid = $state(false);

	$effect(() => {
		if (form?.rfidRegenerated) {
			showToast('success', 'Badge RFID régénéré.');
			rfidUnderstood = false;
		} else if (form?.rfidError) {
			showToast('error', form.rfidError);
			rfidSectionOpen = true;
		}
	});
</script>

{#snippet accordionHeader(title: string, open: boolean, toggle: () => void)}
	<button
		type="button"
		onclick={toggle}
		class="mt-8 flex w-full items-center justify-between bg-black px-4 py-3 text-base font-bold text-white uppercase"
		aria-expanded={open}
	>
		{title}
		<svg
			viewBox="0 0 12 8"
			class="h-2.5 w-2.5 shrink-0 fill-current transition-transform {open ? 'rotate-180' : ''}"
			aria-hidden="true"
		>
			<path d="M0 0 L12 0 L6 8 Z" />
		</svg>
	</button>
{/snippet}

<svelte:head>
	<title>{data.profile.name} — Administration — Passport</title>
</svelte:head>

<section class="mx-auto max-w-2xl">
	<a href="/admin" class="mb-4 inline-block text-sm">← Retour à la liste</a>

	<h1 class="mb-6 bg-black px-4 py-3 text-base font-bold text-white uppercase">
		{data.profile.name}
	</h1>

	<div class="mb-6 flex items-center gap-4">
		{#if data.profile.avatar}
			<div class="flex shrink-0 flex-col items-center gap-1">
				<img src={avatarSize(data.profile.avatar, 128)} alt="" class="h-16 w-16 object-cover" />
				{#if data.hasLocalAvatar}
					<!-- Moderation only: removes the uploaded photo, the member falls back to generated initials. -->
					<form
						method="POST"
						action="?/deleteAvatar"
						use:enhance={() =>
							async ({ result, update }) => {
								await update();
								if (result.type === 'success') showToast('success', 'Photo supprimée.');
							}}
					>
						<button type="submit" class="text-xs text-red-700 underline">Supprimer la photo</button>
					</form>
				{/if}
			</div>
		{/if}
		<div class="text-sm">
			<p><span class="font-bold uppercase">Identifiant :</span> {data.profile.username}</p>
			<p><span class="font-bold uppercase">Email :</span> {data.profile.email}</p>
			<p>
				<span class="font-bold uppercase">Chat :</span>
				{#if data.mattermostUnavailable}
					<span class="text-gray-500">Impossible de vérifier pour le moment</span>
				{:else if data.mattermostUsername && data.mattermostDmUrl}
					<a href={data.mattermostDmUrl} target="_blank" rel="noopener">
						@{data.mattermostUsername}
					</a>
				{:else}
					<span class="text-gray-500">Pas de compte lié ou actif</span>
				{/if}
			</p>
		</div>
	</div>

	<ProfileForm profile={data.profile} fields={data.fields} {form} collapsibleSocials={false} />

	{@render accordionHeader('Visibilité trombinoscope', optinSectionOpen, () => (optinSectionOpen = !optinSectionOpen))}
	{#if optinSectionOpen}
		<form
			method="POST"
			action="?/updateOptin"
			class="border border-black p-4"
			use:enhance={() => {
				submittingOptin = true;
				return async ({ update }) => {
					await update({ reset: false });
					submittingOptin = false;
				};
			}}
		>
			<label class="flex w-fit cursor-pointer items-center gap-3 text-sm">
				<span
					class="relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors {visible
						? 'bg-black'
						: 'bg-gray-300'}"
				>
					<input
						type="checkbox"
						name="visible"
						bind:checked={visible}
						class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
					/>
					<span
						class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {visible
							? 'translate-x-5'
							: ''}"
					></span>
				</span>
				Visible dans le trombinoscope
			</label>

			{#if visible}
				<p class="mt-4 mb-2 text-xs font-bold uppercase text-gray-600">Champs affichés</p>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					<label class="flex cursor-not-allowed items-center gap-2 text-sm text-gray-400">
						<input type="checkbox" checked disabled />
						Username (obligatoire)
					</label>
					{#each fieldOptins as field (field.key)}
						<label class="flex cursor-pointer items-center gap-2 text-sm">
							<input type="checkbox" name={field.key} bind:checked={fieldOptinState[field.key]} />
							{field.label}
						</label>
					{/each}
				</div>

				{#if fieldOptinState.showMail}
					<div class="mt-3">
						<label class="mb-1 block text-xs font-bold uppercase text-gray-600" for="trombiEmail">
							Email affiché (optionnel)
						</label>
						<input
							id="trombiEmail"
							name="trombiEmail"
							type="email"
							maxlength="254"
							bind:value={trombiEmailValue}
							class="w-full border border-black px-3 py-2 text-sm"
						/>
						<p class="mt-1 text-xs text-gray-500">
							Laissez vide pour afficher l'email de compte du membre, ou indiquez une autre
							adresse à montrer à la place. Adresse publique, visible par tous les membres.
						</p>
					</div>
				{:else}
					<!-- Keeps the override while "Mail" is unchecked — otherwise the field would be absent
					     from the submission and saved as empty, losing the address. -->
					<input type="hidden" name="trombiEmail" value={trombiEmailValue} />
				{/if}
			{/if}

			<p class="mt-4 text-xs text-gray-600">
				Avant d'activer un nouveau champ, assurez-vous du consentement du membre concerné : ces
				informations deviennent publiques dans le trombinoscope.
			</p>

			<button
				type="submit"
				disabled={submittingOptin}
				class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50"
			>
				{submittingOptin ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</form>
	{/if}

	{@render accordionHeader('Tag trombinoscope', tagSectionOpen, () => (tagSectionOpen = !tagSectionOpen))}
	{#if tagSectionOpen}
		<form
			method="POST"
			action="?/updateTag"
			class="border border-black p-4"
			use:enhance={() => {
				submittingTag = true;
				return async ({ update }) => {
					await update({ reset: false });
					submittingTag = false;
				};
			}}
		>
			<div class="mb-4">
				<label class="mb-1 block text-sm font-bold uppercase" for="tag">Rôle</label>
				<input
					id="tag"
					name="tag"
					type="text"
					placeholder="Prés. CA"
					bind:value={tagValue}
					class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
				/>
			</div>
			<div>
				<label class="mb-1 block text-sm font-bold uppercase" for="tagColor">Couleur</label>
				<div class="mb-2 flex flex-wrap gap-2">
					{#each tagColorPresets as preset (preset.hex)}
						<button
							type="button"
							onclick={() => (tagColorValue = preset.hex)}
							class="flex items-center gap-1.5 border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-black hover:text-white"
						>
							<span
								class="h-3 w-3 shrink-0 border border-black"
								style="background-color: #{preset.hex};"
								aria-hidden="true"
							></span>
							{preset.label}
						</button>
					{/each}
				</div>
				<div class="flex items-center gap-2">
					<input
						type="color"
						aria-label="Choisir la couleur"
						value={tagColorPreview}
						oninput={(e) => (tagColorValue = e.currentTarget.value.replace(/^#/, ''))}
						class="h-9 w-9 shrink-0 cursor-pointer border border-black p-0"
					/>
					<div class="flex flex-1 items-stretch border border-black">
						<span class="flex items-center border-r border-black bg-gray-100 px-2 text-sm text-gray-500">
							#
						</span>
						<input
							id="tagColor"
							name="tagColor"
							type="text"
							placeholder="ffd800"
							pattern={'[0-9a-fA-F]{6}'}
							title="6 caractères hexadécimaux, sans le #, ex. ffd800"
							bind:value={tagColorValue}
							class="min-w-0 flex-1 px-2 py-2 font-mono text-sm placeholder:text-gray-300"
						/>
					</div>
				</div>
			</div>

			<button
				type="submit"
				disabled={submittingTag}
				class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50"
			>
				{submittingTag ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</form>
	{/if}

	{@render accordionHeader('Permissions', permissionsSectionOpen, () => (permissionsSectionOpen = !permissionsSectionOpen))}
	{#if permissionsSectionOpen}
		<p class="mt-3 mb-3 text-xs text-gray-500">
			Les groupes ne peuvent être modifiés que par un admin du SSO, directement dans Authentik.
		</p>
		{#if data.groups === null}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
				Impossible de charger les groupes pour le moment, réessayez plus tard.
			</p>
		{:else if data.groups.length > 0}
			<!-- Mobile: stacked cards, no horizontal scroll. From sm: a real table instead. -->
			<div class="space-y-2 sm:hidden">
				{#each data.groups as group (group.name)}
					<div class="border border-black p-3 text-sm">
						<p class="flex flex-wrap items-center gap-2 font-bold">
							{group.name}
							{#if group.isSuperuser}
								<span class="bg-black px-1.5 py-0.5 text-xs text-lghs-yellow uppercase">Admin</span>
							{/if}
						</p>
						{#if group.note}
							<p class="mt-1 text-gray-600">{group.note}</p>
						{/if}
					</div>
				{/each}
			</div>

			<div class="hidden overflow-x-auto sm:block">
				<table class="w-full table-fixed border-collapse text-sm">
					<thead>
						<tr class="font-bold uppercase">
							<th class="w-1/3 border border-black px-3 py-2 text-left">Permission</th>
							<th class="border border-black px-3 py-2 text-left">Description</th>
						</tr>
					</thead>
					<tbody>
						{#each data.groups as group (group.name)}
							<tr>
								<td class="border border-black px-3 py-2 font-bold">
									{group.name}
									{#if group.isSuperuser}
										<span class="ml-1 bg-black px-1.5 py-0.5 text-xs text-lghs-yellow uppercase">
											Admin
										</span>
									{/if}
								</td>
								<td class="border border-black px-3 py-2 text-gray-600">{group.note ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
				Aucun groupe associé à ce compte.
			</p>
		{/if}
	{/if}

	{@render accordionHeader("Contacts d'urgence", emergencyContactsSectionOpen, () => (emergencyContactsSectionOpen = !emergencyContactsSectionOpen))}
	{#if emergencyContactsSectionOpen}
		{#if data.emergencyContacts === null}
			<p class="border border-black bg-gray-100 px-4 py-3 text-sm text-gray-600">
				Impossible de charger les contacts d'urgence pour le moment. Réessayez plus tard.
			</p>
		{:else}
			<EmergencyContactsForm
				contacts={data.emergencyContacts}
				maxContacts={data.maxEmergencyContacts}
				{form}
				adminView
			/>
		{/if}
	{/if}

	{@render accordionHeader('Badge RFID', rfidSectionOpen, () => (rfidSectionOpen = !rfidSectionOpen))}
	{#if rfidSectionOpen}
		<div class="mt-3 mb-4">
			<span class="mb-1 block text-sm font-bold uppercase">Identifiant (UUID)</span>
			{#if data.rfidUid === undefined}
				<div class="border border-black bg-gray-100 px-3 py-2 text-sm text-gray-500">
					Impossible de charger le badge pour le moment, réessayez plus tard.
				</div>
			{:else if data.rfidUid === null}
				<div class="border border-black bg-gray-100 px-3 py-2 text-sm text-gray-500">
					Aucun badge assigné.
				</div>
			{:else}
				<div class="flex items-center gap-2 border border-black bg-gray-100 px-3 py-2">
					<p class="flex-1 font-mono text-sm">
						{showRfidUid ? data.rfidUid : '•'.repeat(data.rfidUid.length)}
					</p>
					<button
						type="button"
						onclick={() => (showRfidUid = !showRfidUid)}
						aria-label={showRfidUid ? "Masquer l'identifiant" : "Afficher l'identifiant"}
						title={showRfidUid ? "Masquer l'identifiant" : "Afficher l'identifiant"}
						class="shrink-0 text-gray-600 hover:text-black"
					>
						{#if showRfidUid}
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
			{/if}
		</div>
		<div class="border-4 border-black">
			<div class="hazard-stripes h-2"></div>
			<div class="p-6">
				<p class="mb-3 text-sm font-bold uppercase">Attention, action irréversible</p>
				<p class="mb-4 text-sm leading-relaxed">
					En régénérant l'UUID de ce membre, son (ses) badge(s) actuel(s) cessera(ont) de
					fonctionner immédiatement. À n'utiliser qu'à sa demande explicite (badge perdu ou
					copié), jamais par précaution.
				</p>
				<form
					method="POST"
					action="?/regenerateRfid"
					use:enhance={() => {
						submittingRfid = true;
						return async ({ update }) => {
							await update();
							submittingRfid = false;
						};
					}}
				>
					<label class="mb-4 flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							name="confirmRegenerate"
							value="yes"
							bind:checked={rfidUnderstood}
							class="mt-1"
						/>
						J'ai confirmé avec le membre que son (ses) badge(s) actuel(s) doit (doivent) être
						régénéré(s).
					</label>
					<button
						type="submit"
						disabled={!rfidUnderstood || submittingRfid}
						class="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
					>
						{submittingRfid ? 'Régénération…' : 'Confirmer la régénération'}
					</button>
				</form>
			</div>
			<div class="hazard-stripes h-2"></div>
		</div>
	{/if}
</section>
