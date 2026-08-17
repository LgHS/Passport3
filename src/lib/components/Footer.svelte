<script lang="ts">
	import { version } from '../../../package.json';
	import type { MattermostCacheStatus, SystemStatus } from '$lib/types';

	let {
		status = null,
		mattermostCacheStatus = null
	}: { status?: SystemStatus | null; mattermostCacheStatus?: MattermostCacheStatus | null } =
		$props();

	// Mattermost's dot/latency below come from the same live ping as Authentik/Dolibarr
	// (status.mattermost). This formats the *separate* concern of how stale the directory-lookup
	// cache is (mattermost.ts's getMattermostCacheStatus()) — a healthy ping doesn't tell you when
	// the trombinoscope's email->username map was last actually rebuilt.
	function cacheAgeLabel(cachedAt: number): string {
		const minutes = Math.floor((Date.now() - cachedAt) / 60_000);
		if (minutes < 1) return "à l'instant";
		if (minutes < 60) return `il y a ${minutes} min`;
		return `il y a ${Math.floor(minutes / 60)}h`;
	}
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
				<span class="flex items-center gap-1.5">
					<span
						class="h-2 w-2 shrink-0 rounded-full {status.mattermost.healthy ? 'bg-green-600' : 'bg-red-600'}"
						aria-hidden="true"
					></span>
					Mattermost <i>+{status.mattermost.latencyMs}ms</i>
					{#if mattermostCacheStatus}
						<i>(cache {cacheAgeLabel(mattermostCacheStatus.cachedAt)})</i>
					{:else}
						<i>(cache jamais rempli)</i>
					{/if}
				</span>
			</p>
		{/if}
	</div>
</footer>
