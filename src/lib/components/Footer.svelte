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

		<p class="mt-2 text-sm">
			<b>Liège Hackerspace ASBL</b> —
			<a
				href="https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=649448256"
				target="_blank"
				rel="noopener"
			>
				BE0649.448.256
			</a>
			<br />
			<b>Mail:</b> <a href="mailto:ping@lghs.be">ping@lghs.be</a>
		</p>

		<div class="mt-3 flex flex-wrap items-center justify-center gap-3">
			<a
				href="https://www.facebook.com/liegehackerspace/"
				title="Facebook"
				target="_blank"
				rel="noopener"
				class="no-underline-fx block h-6 w-6 transition-opacity hover:opacity-70"
			>
				<img src="/social/facebook.svg" alt="Facebook" class="h-full w-full" />
			</a>
			<a
				href="https://www.instagram.com/lghackerspace/"
				title="Instagram"
				target="_blank"
				rel="noopener"
				class="no-underline-fx block h-6 w-6 transition-opacity hover:opacity-70"
			>
				<img src="/social/instagram.svg" alt="Instagram" class="h-full w-full" />
			</a>
			<a
				href="https://mastodon.social/@lghackerspace"
				title="Mastodon"
				target="_blank"
				rel="noopener"
				class="no-underline-fx block h-6 w-6 transition-opacity hover:opacity-70"
			>
				<img src="/social/mastodon.svg" alt="Mastodon" class="h-full w-full" />
			</a>
			<a
				href="https://github.com/LgHS"
				title="GitHub"
				target="_blank"
				rel="noopener"
				class="no-underline-fx block h-6 w-6 transition-opacity hover:opacity-70"
			>
				<img src="/social/github.svg" alt="GitHub" class="h-full w-full" />
			</a>
			<a
				href="https://hackerspaces.be/"
				title="Hackerspaces.be"
				target="_blank"
				rel="noopener"
				class="no-underline-fx block h-6 w-6 transition-opacity hover:opacity-70"
			>
				<img src="/social/spaceinvaders.svg" alt="Hackerspaces.be" class="h-full w-full" />
			</a>
			<a
				href="https://mapall.space/heatmap/show.php?id=Liege+Hackerspace"
				title="Heatmap"
				target="_blank"
				rel="noopener"
				class="no-underline-fx block h-6 w-6 transition-opacity hover:opacity-70"
			>
				<img src="/social/heat.svg" alt="Heatmap" class="h-full w-full" />
			</a>
			<a
				href="http://spaceapi.lghs.be/"
				title="Space API"
				target="_blank"
				rel="noopener"
				class="no-underline-fx block h-6 w-6 transition-opacity hover:opacity-70"
			>
				<img src="/social/spaceapi.svg" alt="Space API" class="h-full w-full" />
			</a>
		</div>

		{#if status}
			<p class="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-500">
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
				<span class="flex items-center gap-1.5">
					<span
						class="h-2 w-2 shrink-0 rounded-full {status.database.healthy ? 'bg-green-600' : 'bg-red-600'}"
						aria-hidden="true"
					></span>
					Base de données <i>+{status.database.latencyMs}ms</i>
				</span>
			</p>
		{/if}
	</div>
</footer>
