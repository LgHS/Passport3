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
		form,
		collapsibleSocials = true
	}: {
		profile: UserProfile;
		fields: ProfileAttributeField[];
		form: FormResult;
		// The member-facing /profile form tucks Signal/Telegram/Discord/Matrix behind a collapsed
		// "Divers" panel — optional fields the member may never fill in. The admin edit form shows
		// them flat instead: an admin editing on someone's behalf (oral/email request) needs to see
		// everything at a glance, not remember to expand a panel.
		collapsibleSocials?: boolean;
	} = $props();

	let submitting = $state(false);
	// svelte-ignore state_referenced_locally
	let socialsOpen = $state(!collapsibleSocials);

	// Every validator for a field that lives inside the "Divers (facultatifs)" panel
	// (validateSignalUsername/validateTelegramUsername/validateDiscordUsername/validateMatrixId/
	// validateBirthday) starts its error message with the field's own label — used to detect that
	// the error concerns something inside the panel, not the generic top banner.
	let isDiversError = $derived(
		/^(Signal|Telegram|Discord|Matrix|Date de naissance) :/.test(form?.error ?? '')
	);

	// The panel is collapsed by default, so an error inside it would otherwise be invisible — force
	// it open when one comes back from the server. Only ever sets it to true, never closes it back
	// down, so a manual toggle by the member elsewhere isn't fought.
	$effect(() => {
		if (isDiversError) socialsOpen = true;
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

	const MONTHS = [
		'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
		'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
	];

	// Stored as "YYYY-MM-DD" (year known) or "MM-DD" (year omitted) — see validateBirthday() in
	// profileValidation.ts. The year is deliberately optional: a member may want to share their
	// birthday without revealing their age.
	function splitBirthday(value: string): { day: string; month: string; year: string } {
		const withYear = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (withYear) return { year: withYear[1], month: String(Number(withYear[2])), day: String(Number(withYear[3])) };
		const withoutYear = value.match(/^(\d{2})-(\d{2})$/);
		if (withoutYear) return { year: '', month: String(Number(withoutYear[1])), day: String(Number(withoutYear[2])) };
		return { day: '', month: '', year: '' };
	}

	const birthdayInitial = splitBirthday(fieldValue('birthday'));
	// svelte-ignore state_referenced_locally
	let birthdayDay = $state(birthdayInitial.day);
	// svelte-ignore state_referenced_locally
	let birthdayMonth = $state(birthdayInitial.month);
	// svelte-ignore state_referenced_locally
	let birthdayYear = $state(birthdayInitial.year);
	// Checked by default — unlike the rest of this form's optional fields, this one defaults to on.
	// Only an explicit "false" (the member unchecked it and saved) turns it off; a never-set value
	// (empty string) still defaults to checked.
	// svelte-ignore state_referenced_locally
	let birthdayAnnounce = $state(fieldValue('birthdayAnnounce') !== 'false');
	let birthdayCombined = $derived.by(() => {
		const day = birthdayDay.trim();
		const month = birthdayMonth.trim();
		const year = birthdayYear.trim();
		if (!day && !month) return '';
		const pad2 = (n: string) => n.padStart(2, '0');
		// Only one of day/month filled: send through deliberately malformed (e.g. "06-" or "-15")
		// instead of collapsing to '' — validateBirthday() on the server rejects this with a clear
		// error ("jour et mois sont obligatoires") rather than the half-filled date being silently
		// discarded with no feedback.
		if (!day || !month) return `${month ? pad2(month) : ''}-${day ? pad2(day) : ''}`;
		return year ? `${year}-${pad2(month)}-${pad2(day)}` : `${pad2(month)}-${pad2(day)}`;
	});
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
		{#if collapsibleSocials}
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
		{:else}
			<p class="border-b border-black px-4 py-3 text-sm font-bold uppercase">Divers (facultatifs)</p>
		{/if}
		{#if socialsOpen}
			<div class="border-t border-black p-4">
				<div class="mb-4">
					<label class="mb-1 block text-sm font-bold uppercase" for="birthdayDay">
						Date de naissance
					</label>
					<div class="flex flex-wrap items-center justify-between gap-4">
						<div class="grid w-full grid-cols-[5rem_1fr_6rem] gap-2 md:w-auto">
							<input
								id="birthdayDay"
								type="text"
								inputmode="numeric"
								pattern={'[0-9]{1,2}'}
								maxlength="2"
								placeholder="Jour"
								bind:value={birthdayDay}
								class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
							/>
							<select
								bind:value={birthdayMonth}
								class="w-full border border-black bg-white px-3 py-2 text-sm {birthdayMonth
									? ''
									: 'text-gray-400'}"
							>
								<option value="" selected={!birthdayMonth}>Mois</option>
								{#each MONTHS as month, i (month)}
									<option value={String(i + 1)}>{month}</option>
								{/each}
							</select>
							<input
								type="text"
								inputmode="numeric"
								pattern={'[0-9]{4}'}
								maxlength="4"
								placeholder="Année"
								bind:value={birthdayYear}
								title="Facultatif — laissez vide pour ne partager que le jour et le mois"
								class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
							/>
						</div>
						<label class="flex w-full cursor-pointer items-center gap-3 text-sm md:w-fit">
							<span
								class="relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors {birthdayAnnounce
									? 'bg-black'
									: 'bg-gray-300'}"
							>
								<input
									type="checkbox"
									name="birthdayAnnounce"
									bind:checked={birthdayAnnounce}
									class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
								/>
								<span
									class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {birthdayAnnounce
										? 'translate-x-5'
										: ''}"
								></span>
							</span>
							Souhaitez-moi un bon anniversaire !
						</label>
					</div>
					<p class="mt-1 text-xs text-gray-500">
						Facultative. L'année est elle-même facultative si vous préférez ne partager que le
						jour et le mois.
					</p>
					<input type="hidden" name="birthday" value={birthdayCombined} />
				</div>
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
