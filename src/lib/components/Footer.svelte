<script lang="ts">
	import { version } from '../../../package.json';
	import type { SystemStatus } from '$lib/types';

	let { status = null }: { status?: SystemStatus | null } = $props();
</script>

<footer class="mt-14 border-t-4 border-black py-8">
	<div class="mx-auto max-w-5xl px-4 text-center">
		<p class="text-sm">
			<b>Passport</b> — member portal of the
			<a href="https://lghs.be" target="_blank" rel="noopener">Liège Hackerspace</a>
			—
			<a
				href="https://github.com/LgHS/Passport3/releases/tag/v{version}"
				target="_blank"
				rel="noopener"
			>
				v{version}
			</a>
		</p>
		{#if status}
			<p class="mt-2 flex items-center justify-center gap-4 text-xs text-gray-500">
				<span class="flex items-center gap-1.5">
					<span
						class="h-2 w-2 shrink-0 rounded-full {status.authentik.healthy ? 'bg-green-600' : 'bg-red-600'}"
						aria-hidden="true"
					></span>
					Authentik <i>+{status.authentik.latencyMs}ms</i>
				</span>
				<span class="flex items-center gap-1.5">
					<span
						class="h-2 w-2 shrink-0 rounded-full {status.dolibarr.healthy ? 'bg-green-600' : 'bg-red-600'}"
						aria-hidden="true"
					></span>
					Dolibarr <i>+{status.dolibarr.latencyMs}ms</i>
				</span>
			</p>
		{/if}
	</div>
</footer>
