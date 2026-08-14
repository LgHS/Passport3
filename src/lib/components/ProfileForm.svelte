<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { ProfileAttributeField, UserProfile } from '$lib/types';

	type FormResult = {
		success?: boolean;
		error?: string;
		changed?: boolean;
		firstName?: string;
		lastName?: string;
		attributes?: Record<string, string>;
	} | null;

	let {
		profile,
		fields,
		form
	}: {
		profile: UserProfile;
		fields: ProfileAttributeField[];
		form: FormResult;
	} = $props();

	let submitting = $state(false);
	let socialsOpen = $state(false);

	// Every validateSignalUsername()/validateTelegramUsername()/validateDiscordUsername()/
	// validateMatrixId() error message starts with its network's name — used to route the error
	// into the "Divers (facultatifs)" panel instead of the generic top banner.
	let isSocialError = $derived(/^(Signal|Telegram|Discord|Matrix) :/.test(form?.error ?? ''));

	// The panel is collapsed by default, so a social error would otherwise be invisible — force it
	// open when one comes back from the server. Only ever sets it to true, never closes it back
	// down, so a manual toggle by the member elsewhere isn't fought.
	$effect(() => {
		if (isSocialError) socialsOpen = true;
	});

	$effect(() => {
		if (form?.success) {
			showToast('success', form.changed ? 'Les données ont été enregistrées.' : 'Aucune modification à enregistrer.');
		} else if (form?.error) {
			showToast('error', form.error);
		}
	});

	function fieldLabel(key: string): string {
		return fields.find((f) => f.key === key)?.label ?? key;
	}

	function fieldValue(key: string): string {
		return form?.attributes?.[key] ?? profile.attributes[key] ?? '';
	}

	// Authentik only has one `name` field — split it for display, merged back on save.
	function splitName(fullName: string): { firstName: string; lastName: string } {
		const [first = '', ...rest] = fullName.trim().split(/\s+/);
		return { firstName: first, lastName: rest.join(' ') };
	}

	let nameFallback = $derived(splitName(profile.name));
	let firstNameValue = $derived(form?.firstName ?? nameFallback.firstName);
	let lastNameValue = $derived(form?.lastName ?? nameFallback.lastName);

	// Split into the two editable blocks either side of the fixed "@"/":" — the member never has to
	// type those themselves, so they can't get the format wrong on that part.
	function splitMatrixId(value: string): { localpart: string; domain: string } {
		if (!value.startsWith('@')) return { localpart: '', domain: '' };
		const rest = value.slice(1);
		const colonIndex = rest.indexOf(':');
		if (colonIndex === -1) return { localpart: rest, domain: '' };
		return { localpart: rest.slice(0, colonIndex), domain: rest.slice(colonIndex + 1) };
	}

	const matrixInitial = splitMatrixId(fieldValue('matrix'));
	// svelte-ignore state_referenced_locally
	let matrixLocalpart = $state(matrixInitial.localpart);
	// svelte-ignore state_referenced_locally
	let matrixDomain = $state(matrixInitial.domain);
	// Recombined into the single string validateMatrixId() expects — sent via a hidden input, the
	// two visible ones never submit directly.
	let matrixCombined = $derived(
		matrixLocalpart.trim() || matrixDomain.trim()
			? `@${matrixLocalpart.trim()}:${matrixDomain.trim()}`
			: ''
	);
</script>

{#snippet textField(
	key: string,
	opts?: { type?: string; pattern?: string; title?: string; placeholder?: string; required?: boolean }
)}
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for={key}>{fieldLabel(key)}</label>
		<input
			id={key}
			name={key}
			type={opts?.type ?? 'text'}
			pattern={opts?.pattern}
			title={opts?.title}
			placeholder={opts?.placeholder}
			required={opts?.required ?? true}
			value={fieldValue(key)}
			class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
		/>
	</div>
{/snippet}

<form
	method="POST"
	action="?/updateProfile"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			// Don't let the native form reset wipe the fields back to their initial
			// (possibly empty) defaultValue on a successful submit.
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	<div class="mb-4 grid grid-cols-2 gap-4">
		<div>
			<label class="mb-1 block text-sm font-bold uppercase" for="firstName">Prénom</label>
			<input
				id="firstName"
				name="firstName"
				type="text"
				required
				value={firstNameValue}
				class="w-full border border-black px-3 py-2 text-sm"
			/>
		</div>
		<div>
			<label class="mb-1 block text-sm font-bold uppercase" for="lastName">Nom</label>
			<input
				id="lastName"
				name="lastName"
				type="text"
				required
				value={lastNameValue}
				class="w-full border border-black px-3 py-2 text-sm"
			/>
		</div>
	</div>

	<div class="mb-4">
		{@render textField('phoneNumber', {
			type: 'tel',
			pattern: '[1-9][0-9]{7,14}',
			title: 'Format attendu : 32470000000 (sans "+" ni "0" initial)'
		})}
	</div>

	<div class="mb-4">
		{@render textField('street')}
	</div>

	<div class="mb-4 grid grid-cols-2 gap-4">
		{@render textField('postal_code')}
		{@render textField('locality')}
	</div>

	<div class="mb-4">
		{@render textField('country')}
	</div>

	<div class="mb-4 border border-black">
		<button
			type="button"
			onclick={() => (socialsOpen = !socialsOpen)}
			class="flex w-full items-center justify-between px-4 py-3 text-sm font-bold uppercase"
			aria-expanded={socialsOpen}
		>
			Divers (facultatifs)
			<svg
				viewBox="0 0 12 8"
				class="h-2.5 w-2.5 shrink-0 fill-current transition-transform {socialsOpen
					? 'rotate-180'
					: ''}"
				aria-hidden="true"
			>
				<path d="M0 0 L12 0 L6 8 Z" />
			</svg>
		</button>
		{#if socialsOpen}
			<div class="border-t border-black p-4">
				<div class="mb-4">
					{@render textField('signal', {
						required: false,
						placeholder: 'ana.27',
						title: 'Format attendu : pseudo.chiffres (ex. ana.27)'
					})}
				</div>
				<div class="mb-4">
					{@render textField('telegram', {
						required: false,
						placeholder: 'mon_pseudo',
						title: 'Pseudo Telegram, 5 à 32 caractères, commence par une lettre'
					})}
				</div>
				<div class="mb-4">
					{@render textField('discord', {
						required: false,
						placeholder: 'mon.pseudo',
						title: 'Pseudo Discord, 2 à 32 caractères, minuscules'
					})}
				</div>
				<div>
					<label class="mb-1 block text-sm font-bold uppercase" for="matrixLocalpart">
						Matrix
					</label>
					<div class="flex items-stretch border border-black">
						<span
							class="flex items-center border-r border-black bg-gray-100 px-2 text-sm text-gray-500"
						>
							@
						</span>
						<input
							id="matrixLocalpart"
							type="text"
							placeholder="ana"
							bind:value={matrixLocalpart}
							title="Pseudo Matrix (avant le ':')"
							class="min-w-0 flex-1 px-2 py-2 text-sm placeholder:text-gray-300"
						/>
						<span
							class="flex items-center border-x border-black bg-gray-100 px-2 text-sm text-gray-500"
						>
							:
						</span>
						<input
							type="text"
							placeholder="matrix.org"
							bind:value={matrixDomain}
							title="Serveur Matrix (après le ':'), ex. matrix.org"
							class="min-w-0 flex-1 px-2 py-2 text-sm placeholder:text-gray-300"
						/>
					</div>
					<input type="hidden" name="matrix" value={matrixCombined} />
				</div>
			</div>
		{/if}
	</div>

	<button type="submit" disabled={submitting} class="btn-primary px-6 py-3 disabled:opacity-50">
		{submitting ? 'Enregistrement…' : 'Enregistrer'}
	</button>
</form>
