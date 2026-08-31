<script lang="ts">
	import { COTISATION_STATUS_LABEL, COTISATION_STATUS_COLOR, type CotisationStatus } from '$lib/types';

	let { status }: { status: CotisationStatus } = $props();
</script>

<a
	href="/cotisation"
	class="no-underline-fx flex items-center gap-2 text-sm text-gray-600 hover:text-black"
>
	<span
		class="status-dot"
		class:pulse={status === 'a_jour'}
		style="background-color: {COTISATION_STATUS_COLOR[status]}; box-shadow: 0 0 6px {COTISATION_STATUS_COLOR[
			status
		]};"
		aria-hidden="true"
	></span>
	{COTISATION_STATUS_LABEL[status]}
</a>

<style>
	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.status-dot.pulse {
		animation: pulse-dot 2s infinite;
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
