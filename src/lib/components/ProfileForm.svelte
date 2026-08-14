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

	$effect(() => {
		if (form?.success) {
			showToast('success', form.changed ? 'Les données ont été enregistrées.' : 'Aucune modification à enregistrer.');
		} else if (form?.error) {
			showToast('error', form.error);
		}
	});
</script>

{#snippet textField(key: string, opts?: { type?: string; pattern?: string; title?: string })}
	<div>
		<label class="mb-1 block text-sm font-bold uppercase" for={key}>{fieldLabel(key)}</label>
		<input
			id={key}
			name={key}
			type={opts?.type ?? 'text'}
			pattern={opts?.pattern}
			title={opts?.title}
			required
			value={fieldValue(key)}
			class="w-full border border-black px-3 py-2 text-sm"
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

	<button type="submit" disabled={submitting} class="btn-primary px-6 py-3 disabled:opacity-50">
		{submitting ? 'Enregistrement…' : 'Enregistrer'}
	</button>
</form>
