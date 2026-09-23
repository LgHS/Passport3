<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import type { EmergencyContact } from '$lib/types';

	type FormResult = {
		emergencyContactsSuccess?: boolean;
		emergencyContactsError?: string;
		emergencyContacts?: EmergencyContact[];
	} | null;

	let {
		contacts,
		maxContacts,
		form,
		adminView = false
	}: {
		contacts: EmergencyContact[];
		maxContacts: number;
		form: FormResult;
		// The intro/disclaimer text says "vous" on the member's own /profile, but that pronoun
		// doesn't refer to the right person on /admin/users/[pk] — an admin editing someone else's
		// contacts needs "le membre", not "vous" (which would read as the admin themselves).
		adminView?: boolean;
	} = $props();

	function emptyRow(): EmergencyContact {
		return { name: '', phone: '', relation: '' };
	}

	// Seeded once from the load/form result, same rationale as every other form in this app: the
	// form owns its rows once the member starts editing, not kept in sync afterwards.
	// svelte-ignore state_referenced_locally
	let rows = $state<EmergencyContact[]>(
		(form?.emergencyContacts ?? contacts).length > 0
			? (form?.emergencyContacts ?? contacts).map((c) => ({ ...c }))
			: [emptyRow()]
	);
	let submitting = $state(false);

	function addRow() {
		if (rows.length < maxContacts) {
			rows = [...rows, emptyRow()];
		}
	}

	function removeRow(index: number) {
		const next = rows.filter((_, i) => i !== index);
		rows = next.length > 0 ? next : [emptyRow()];
	}

	$effect(() => {
		if (form?.emergencyContactsSuccess) {
			showToast('success', "Contacts d'urgence mis à jour.");
		} else if (form?.emergencyContactsError) {
			showToast('error', form.emergencyContactsError);
		}
	});
</script>

<p class="mb-4 text-sm leading-relaxed">
	{#if adminView}
		Les contacts d'urgence permettent aux admins de contacter une personne de confiance en cas de
		problème (santé, sécurité, ...) au hackerspace. Indiquez des proches connaissant bien le
		membre ou ayant une facilité à le joindre.
	{:else}
		Les contacts d'urgence permettent aux admins de contacter une personne de confiance en cas de
		problème (santé, sécurité, ...) au hackerspace. Indiquez des proches vous connaissant bien ou
		ayant une facilité à vous joindre.
	{/if}
</p>

<form
	method="POST"
	action="?/updateEmergencyContacts"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	<div class="space-y-3">
		{#each rows as row, i (i)}
			<div class="grid grid-cols-1 gap-2 border border-black p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
				<div>
					<label class="mb-1 block text-xs font-bold uppercase" for="contact-name-{i}">Nom</label>
					<input
						id="contact-name-{i}"
						type="text"
						name="name[]"
						bind:value={row.name}
						placeholder="Jeanne Dupont"
						class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs font-bold uppercase" for="contact-phone-{i}">
						Téléphone (format : 32470000000)
					</label>
					<input
						id="contact-phone-{i}"
						type="tel"
						name="phone[]"
						pattern={'[1-9][0-9]{7,14}'}
						title={'Format attendu : 32470000000 (sans "+" ni "0" initial)'}
						bind:value={row.phone}
						placeholder="32470000000"
						class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs font-bold uppercase" for="contact-relation-{i}">
						Lien (optionnel)
					</label>
					<input
						id="contact-relation-{i}"
						type="text"
						name="relation[]"
						bind:value={row.relation}
						placeholder="Conjoint·e, parent…"
						class="w-full border border-black px-3 py-2 text-sm placeholder:text-gray-300"
					/>
				</div>
				<button
					type="button"
					onclick={() => removeRow(i)}
					class="h-fit px-3 py-2 text-xs font-bold uppercase underline"
				>
					Retirer
				</button>
			</div>
		{/each}
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-3">
		<button
			type="button"
			onclick={addRow}
			disabled={rows.length >= maxContacts}
			class="border border-black px-3 py-2 text-xs font-bold uppercase transition-colors hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black"
		>
			+ Ajouter un contact
		</button>
		<span class="text-xs text-gray-500">{rows.length} / {maxContacts}</span>
	</div>

	<p class="mt-3 text-xs text-gray-500">
		{#if adminView}
			Ces informations ne sont jamais visibles dans le trombinoscope : seuls ce membre et les
			admins peuvent les consulter, en cas d'urgence.
		{:else}
			Ces informations ne seront jamais visibles dans le trombinoscope : seuls vous-même et les
			admins peuvent les consulter, en cas d'urgence.
		{/if}
	</p>

	<button
		type="submit"
		disabled={submitting}
		class="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-50"
	>
		{submitting ? 'Enregistrement…' : 'Enregistrer'}
	</button>
</form>
