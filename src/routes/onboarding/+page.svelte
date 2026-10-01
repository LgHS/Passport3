<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// PROTOTYPE — the journey's look and flow only. Nothing is saved: "Continuer" just moves on.
	const STEPS = [
		{ id: 'depart', label: 'Départ', icon: '🏁', eta: 3 },
		{ id: 'infos', label: 'Infos', icon: '🪪', eta: 3 },
		{ id: 'photo', label: 'Photo', icon: '📷', eta: 2 },
		{ id: 'urgence', label: 'Urgence', icon: '🆘', eta: 2 },
		{ id: 'competences', label: 'Compétences', icon: '🛠️', eta: 1 },
		{ id: 'roi', label: 'ROI', icon: '📜', eta: 1 },
		{ id: 'arrivee', label: 'Arrivée', icon: '🏠', eta: 0 }
	] as const;

	// GPS-style instruction shown above each step.
	const DIRECTIONS: Record<(typeof STEPS)[number]['id'], string> = {
		depart: 'Itinéraire calculé vers le Liège Hackerspace',
		infos: 'Dans 200 m, vérifie tes informations',
		photo: 'Au rond-point, prends la sortie « photo de profil »',
		urgence: 'Reste sur la file de droite : contacts d’urgence',
		competences: 'Prochain arrêt : ce que tu sais faire',
		roi: 'Dernier virage : le règlement d’ordre intérieur',
		arrivee: 'Destination atteinte'
	};

	let index = $state(0);
	let roiAccepted = $state(false);
	let recalculating = $state(false);
	let direction = $state(1);
	const step = $derived(STEPS[index]);
	const progress = $derived(index / (STEPS.length - 1));

	function next() {
		direction = 1;
		index = Math.min(index + 1, STEPS.length - 1);
	}
	function back() {
		direction = -1;
		index = Math.max(index - 1, 0);
	}
	// Skipping a step: a short "recalculating" beat, like a GPS after a missed turn.
	function skip() {
		recalculating = true;
		setTimeout(() => {
			recalculating = false;
			next();
		}, 900);
	}

	const missing = $derived(data.infos.filter((f) => !f.value && !('optional' in f && f.optional)).length);
</script>

<svelte:head>
	<title>Bienvenue — Passport</title>
</svelte:head>

<section class="mx-auto max-w-2xl">
	<p class="mb-3 inline-block bg-lghs-yellow px-2 py-0.5 text-xs font-bold uppercase">Prototype · rien n'est enregistré</p>

	<!-- The route: every stop of the journey, the marker on the current one. -->
	<div class="relative mb-6 px-8 pt-8 pb-2" aria-label="Progression du parcours">
		<div class="absolute top-[3.1rem] right-10 left-10 h-1.5 bg-gray-200"></div>
		<div
			class="absolute top-[3.1rem] left-10 h-1.5 bg-black transition-all duration-500"
			style="width: calc((100% - 5rem) * {progress})"
		></div>
		<div
			class="absolute top-1 text-2xl transition-all duration-500"
			style="left: calc(2.5rem + (100% - 5rem) * {progress} - 0.8rem)"
			aria-hidden="true"
		>
			📍
		</div>
		<ol class="relative mx-2 flex justify-between">
			{#each STEPS as s, i (s.id)}
				<li class="flex w-0 flex-col items-center">
					<span
						class="z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-black text-[10px] font-bold {i <
						index
							? 'bg-black text-white'
							: i === index
								? 'bg-lghs-yellow'
								: 'bg-white'}"
					>
						{i < index ? '✓' : ''}
					</span>
					<span
						class="mt-1 text-[10px] font-bold whitespace-nowrap uppercase {i === index
							? 'text-black'
							: 'hidden text-gray-400 sm:inline'}"
					>
						{s.label}
					</span>
				</li>
			{/each}
		</ol>
	</div>

	<!-- GPS banner: the instruction and what's left. -->
	<div class="mb-4 flex items-center gap-3 bg-black px-4 py-3 text-white">
		<span class="text-3xl leading-none" aria-hidden="true">{index === STEPS.length - 1 ? '🏁' : '↱'}</span>
		<div class="flex-1">
			{#if recalculating}
				<p class="font-bold" in:fade>Recalcul de l’itinéraire…</p>
			{:else}
				<p class="font-bold">{DIRECTIONS[step.id]}</p>
			{/if}
			{#if step.eta > 0}
				<p class="text-xs text-gray-300">Étape {index}/{STEPS.length - 2} · encore ~{step.eta} min</p>
			{/if}
		</div>
	</div>

	<!-- The current step. -->
	{#key index}
		<div class="border-4 border-black p-5" in:fly={{ x: 40 * direction, duration: 250 }}>
			{#if step.id === 'depart'}
				<p class="mb-1 text-4xl" aria-hidden="true">🏁</p>
				<h1 class="mb-2 text-xl font-bold">Bienvenue au Liège Hackerspace, {data.firstName} !</h1>
				<p class="mb-5 text-sm text-gray-600">
					On t’emmène faire le tour de ton compte : tes infos, ta photo, tes contacts d’urgence et
					le règlement. Ça prend environ 3 minutes, et tu peux passer ce qui ne te concerne pas.
				</p>
				<button type="button" onclick={next} class="btn-primary px-5 py-2.5 text-sm">C’est parti →</button>
			{:else if step.id === 'infos'}
				<h2 class="mb-1 text-lg font-bold">🪪 Tes informations</h2>
				<p class="mb-4 text-sm text-gray-600">
					{missing === 0 ? 'Tout est en ordre, vérifie juste que c’est à jour.' : `Il manque ${missing} information${missing > 1 ? 's' : ''}.`}
				</p>
				<dl class="mb-5 divide-y divide-gray-200 border border-black text-sm">
					{#each data.infos as field (field.label)}
						<div class="flex items-center justify-between gap-3 px-3 py-2">
							<dt class="font-bold uppercase">{field.label}</dt>
							{#if field.value}
								<dd class="text-right">{field.value} <span class="ml-1">✓</span></dd>
							{:else}
								<dd class="bg-lghs-yellow px-1.5 text-xs font-bold uppercase">
									{'optional' in field && field.optional ? 'Facultatif' : 'À compléter'}
								</dd>
							{/if}
						</div>
					{/each}
				</dl>
				<div class="flex flex-wrap items-center gap-3">
					<button type="button" onclick={next} class="btn-primary px-5 py-2.5 text-sm">C’est bon ✓</button>
					<a href="/profile" class="text-sm font-bold">Compléter mon profil</a>
				</div>
			{:else if step.id === 'photo'}
				<h2 class="mb-1 text-lg font-bold">📷 Ta photo de profil</h2>
				<p class="mb-4 text-sm text-gray-600">
					Elle t’identifie sur Passport, le trombinoscope et le chat. Une vraie photo aide les autres
					membres à te reconnaître à l’atelier.
				</p>
				<div class="mb-5 flex items-center gap-4">
					{#if data.avatar}
						<img src={data.avatar} alt="" class="h-20 w-20 border-2 border-black object-cover" />
					{/if}
					<p class="text-sm">
						{data.hasPhoto ? 'Tu as déjà une photo, elle te va toujours ?' : 'Pour l’instant, ce sont tes initiales.'}
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<a href="/profile" class="no-underline-fx btn-primary inline-block px-5 py-2.5 text-sm">
						{data.hasPhoto ? 'Changer ma photo' : 'Ajouter une photo'}
					</a>
					<button type="button" onclick={next} class="text-sm font-bold underline">
						{data.hasPhoto ? 'Elle me va →' : 'Garder mes initiales →'}
					</button>
				</div>
			{:else if step.id === 'urgence'}
				<h2 class="mb-1 text-lg font-bold">🆘 Contacts d’urgence</h2>
				<p class="mb-4 text-sm text-gray-600">
					Une personne à prévenir si quelque chose t’arrive au hackerspace. Seuls les admins peuvent
					les voir, et seulement en cas d’urgence.
				</p>
				<p class="mb-5 text-sm font-bold">
					{data.contactCount > 0
						? `✓ ${data.contactCount} contact${data.contactCount > 1 ? 's' : ''} renseigné${data.contactCount > 1 ? 's' : ''}`
						: 'Aucun contact pour l’instant.'}
				</p>
				<div class="flex flex-wrap items-center gap-3">
					{#if data.contactCount > 0}
						<button type="button" onclick={next} class="btn-primary px-5 py-2.5 text-sm">C’est bon ✓</button>
					{:else}
						<a href="/profile?tab=emergency" class="no-underline-fx btn-primary inline-block px-5 py-2.5 text-sm">
							Ajouter un contact
						</a>
					{/if}
				</div>
			{:else if step.id === 'competences'}
				<h2 class="mb-1 text-lg font-bold">🛠️ Ce que tu sais faire</h2>
				<p class="mb-4 text-sm text-gray-600">
					Bientôt : indique tes compétences et les machines sur lesquelles tu es formé·e, pour que
					les autres sachent à qui demander un coup de main.
				</p>
				<div class="mb-5 flex flex-wrap gap-2 opacity-50" aria-hidden="true">
					{#each ['Découpe laser', 'Impression 3D', 'Soudure', 'Électronique', 'Couture', '+ Ajouter'] as tag (tag)}
						<span class="border border-black px-2 py-1 text-xs font-bold">{tag}</span>
					{/each}
				</div>
				<button type="button" onclick={next} class="btn-primary px-5 py-2.5 text-sm">Continuer →</button>
			{:else if step.id === 'roi'}
				<h2 class="mb-1 text-lg font-bold">📜 Règlement d’ordre intérieur</h2>
				<p class="mb-3 text-sm text-gray-600">Quelques règles pour que le hackerspace reste un lieu sûr et agréable.</p>
				<div class="mb-4 max-h-48 overflow-y-auto border border-black bg-gray-50 p-3 text-sm">
					<p class="mb-2 font-bold">Texte du ROI à venir.</p>
					<p class="mb-2">Art. 1 — Respecte les autres membres, le matériel et les lieux.</p>
					<p class="mb-2">Art. 2 — N’utilise une machine que si tu y as été formé·e.</p>
					<p class="mb-2">Art. 3 — Range et nettoie ton poste avant de partir.</p>
					<p>Art. 4 — Signale tout incident ou accident via Passport.</p>
				</div>
				<label class="mb-5 flex cursor-pointer items-start gap-2 text-sm">
					<input type="checkbox" bind:checked={roiAccepted} class="mt-1" />
					J’ai lu et j’accepte le règlement d’ordre intérieur.
				</label>
				<button
					type="button"
					onclick={next}
					disabled={!roiAccepted}
					class="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
				>
					Accepter et terminer →
				</button>
			{:else}
				<div class="relative overflow-hidden text-center">
					<!-- A few falling squares in the hackerspace's colours, nothing heavier. -->
					{#each Array.from({ length: 18 }, (_, i) => i) as i (i)}
						<span
							class="confetti absolute top-0 h-2 w-2 {i % 2 ? 'bg-lghs-yellow' : 'bg-black'}"
							style="left: {(i * 53) % 100}%; animation-delay: {(i % 6) * 0.15}s"
							aria-hidden="true"
						></span>
					{/each}
					<p class="mb-2 text-5xl" aria-hidden="true">🏠</p>
					<h2 class="mb-2 text-xl font-bold">Tu es arrivé·e à destination !</h2>
					<p class="mb-5 text-sm text-gray-600">
						Ton compte est prêt. Le chat, le wiki et les autres outils du hackerspace t’attendent.
					</p>
					<a href="/" class="no-underline-fx btn-primary inline-block px-5 py-2.5 text-sm">Aller à mon tableau de bord</a>
				</div>
			{/if}
		</div>
	{/key}

	<!-- Back / skip, except where they make no sense. -->
	{#if index > 0 && index < STEPS.length - 1}
		<div class="mt-3 flex items-center justify-between text-sm">
			<button type="button" onclick={back} class="font-bold text-gray-600 hover:text-black">← Étape précédente</button>
			{#if step.id !== 'roi'}
				<button type="button" onclick={skip} disabled={recalculating} class="font-bold text-gray-600 underline hover:text-black">
					Passer cette étape
				</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.confetti {
		animation: fall 1.6s ease-in forwards;
		opacity: 0;
	}
	@keyframes fall {
		0% {
			transform: translateY(-10px) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(260px) rotate(320deg);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.confetti {
			display: none;
		}
	}
</style>
