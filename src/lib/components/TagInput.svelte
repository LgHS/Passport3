<script lang="ts">
	// A one-line field where Enter turns what's typed into a removable chip, instead of asking people
	// to respect a separator they'll never respect. The value is submitted through a hidden input as
	// newline-separated text, so the server and the column stay plain text — nothing about the
	// storage or the validator knows this widget exists.
	let {
		name,
		tags = $bindable([]),
		placeholder = '',
		id
	}: {
		name: string;
		tags?: string[];
		placeholder?: string;
		id?: string;
	} = $props();

	let draft = $state('');
	let input = $state<HTMLInputElement | null>(null);

	function commit(): void {
		const value = draft.trim();
		draft = '';
		if (!value || tags.includes(value)) return;
		tags = [...tags, value];
	}

	function remove(index: number): void {
		tags = tags.filter((_, i) => i !== index);
	}

	function handleKeydown(event: KeyboardEvent): void {
		// A comma commits too: people type it out of habit, and rejecting it would just produce one
		// chip containing "Alice, Bob".
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Backspace' && !draft && tags.length > 0) {
			remove(tags.length - 1);
		}
	}
</script>

<!-- Clicking the padding, not just the input itself, focuses the field — the chips make the hit
     area much wider than a normal input's. -->
<div
	class="flex cursor-text flex-wrap items-center gap-1.5 border border-black px-2 py-1.5"
	onclick={() => input?.focus()}
	onkeydown={() => {}}
	role="presentation"
>
	{#each tags as tag, i (tag)}
		<span class="flex items-center gap-1 border border-black bg-gray-100 py-0.5 pr-1 pl-2 text-sm">
			{tag}
			<button
				type="button"
				onclick={() => remove(i)}
				aria-label="Retirer {tag}"
				class="px-1 leading-none font-bold hover:bg-black hover:text-white"
			>
				×
			</button>
		</span>
	{/each}
	<input
		{id}
		bind:this={input}
		bind:value={draft}
		onkeydown={handleKeydown}
		onblur={commit}
		{placeholder}
		type="text"
		class="min-w-40 flex-1 py-0.5 text-sm outline-none placeholder:text-gray-300"
	/>
</div>
<!-- Committed on blur above, so a name typed but never validated with Enter still gets submitted
     rather than silently lost. -->
<input type="hidden" {name} value={tags.join('\n')} />
