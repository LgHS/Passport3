<script lang="ts">
	// A member's username, always shown as "@username". A link to their trombinoscope card when
	// they're listed there (`visibleUsernames`, from listTrombinoscopeUsernames()), plain text
	// otherwise — a member who didn't opt in never gets a link pointing at them.
	let {
		username,
		visibleUsernames = [],
		class: className = ''
	}: { username: string; visibleUsernames?: readonly string[]; class?: string } = $props();
</script>

{#if visibleUsernames.includes(username)}
	<a
		href="/trombinoscope?member={encodeURIComponent(username)}"
		class={className}
		title="Voir la fiche de @{username} dans le trombinoscope">@{username}</a
	>
{:else}
	<span class={className}>@{username}</span>
{/if}
