<script lang="ts">
	import MemberName from '$lib/components/MemberName.svelte';

	// An audit event's author: "Loïc Keyeux (@iooner)", the username in italics and linking to
	// their trombinoscope card when listed (see resolveActorUsernames()). Just the logged name when
	// the username couldn't be resolved.
	let {
		label,
		username,
		visibleUsernames = []
	}: { label: string; username?: string; visibleUsernames?: readonly string[] } = $props();
</script>

{label}{#if username}{' '}<span class="italic">(<MemberName {username} {visibleUsernames} />)</span>{/if}
