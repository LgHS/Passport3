<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import AvatarEditor from '$lib/components/AvatarEditor.svelte';
	import EmergencyContactsForm from '$lib/components/EmergencyContactsForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// PROTOTYPE — profile, photo and emergency contacts really save; the journey itself is not remembered yet.
	const STEPS = [
		{ id: 'depart', label: 'Départ', icon: '🏁', eta: 4 },
		{ id: 'preambule', label: 'Préambule', icon: '📖', eta: 4 },
		{ id: 'infos', label: 'Mon profil', icon: '🪪', eta: 3 },
		{ id: 'photo', label: 'Photo', icon: '📷', eta: 2 },
		{ id: 'urgence', label: 'Urgence', icon: '🆘', eta: 2 },
		{ id: 'competences', label: 'Compétences', icon: '🛠️', eta: 1 },
		{ id: 'roi', label: 'ROI', icon: '📜', eta: 1 },
		{ id: 'arrivee', label: 'Arrivée', icon: '🏠', eta: 0 }
	] as const;

	// GPS-style instruction shown above each step.
	const DIRECTIONS: Record<(typeof STEPS)[number]['id'], string> = {
		depart: 'Itinéraire calculé vers le Liège Hackerspace',
		preambule: 'Avant de démarrer, un mot sur le hackerspace',
		infos: 'Dans 200 m, vérifie ton profil',
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

	// --- Mon profil: the same fields and the same action as /profile's form, only the essentials.
	const attr = (key: string) => data.profile?.attributes[key] ?? '';
	// The form's starting values, from the account as loaded; the inputs own them from there.
	// svelte-ignore state_referenced_locally
	const nameParts = (data.profile?.name ?? '').trim().split(/\s+/);
	let firstName = $state(nameParts[0] ?? '');
	let lastName = $state(nameParts.slice(1).join(' '));
	const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
	// "YYYY-MM-DD" or "MM-DD", as stored.
	const storedBirthday = attr('birthday').match(/^(?:(\d{4})-)?(\d{2})-(\d{2})$/);
	let birthdayYear = $state(storedBirthday?.[1] ?? '');
	let birthdayMonth = $state(storedBirthday ? String(Number(storedBirthday[2])) : '');
	let birthdayDay = $state(storedBirthday ? String(Number(storedBirthday[3])) : '');
	let birthdayAnnounce = $state(attr('birthdayAnnounce') !== 'false');
	const pad2 = (n: string) => n.padStart(2, '0');
	const hasBirthdayDate = $derived(!!birthdayDay.trim() && !!birthdayMonth);
	const birthday = $derived(
		!birthdayDay.trim() && !birthdayMonth
			? ''
			: birthdayYear.trim()
				? `${birthdayYear.trim()}-${pad2(birthdayMonth)}-${pad2(birthdayDay.trim())}`
				: `${pad2(birthdayMonth)}-${pad2(birthdayDay.trim())}`
	);
	let savingProfile = $state(false);

	// A successful save moves the journey on; an error stays on the step, with its message.
	function afterSave(savingFlag: (v: boolean) => void, okKey: string, errorKey: string) {
		return () => {
			savingFlag(true);
			return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
				await update({ reset: false });
				savingFlag(false);
				if (result.type === 'success' && result.data?.[okKey]) next();
				else if (result.type === 'failure') showToast('error', String(result.data?.[errorKey] ?? 'La sauvegarde a échoué.'));
			};
		};
	}
</script>

<svelte:head>
	<title>Bienvenue — Passport</title>
</svelte:head>

<section class="mx-auto max-w-4xl">
	<p class="mb-3 inline-block bg-lghs-yellow px-2 py-0.5 text-xs font-bold uppercase">Prototype · le parcours n'est pas encore mémorisé</p>

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
					On t’emmène faire le tour de ton compte : un mot sur le hackerspace, tes infos, ta photo, tes contacts d’urgence et
					le règlement. Ça prend environ 4 minutes, et tu peux passer ce qui ne te concerne pas.
				</p>
				<button type="button" onclick={next} class="btn-primary px-5 py-2.5 text-sm">C’est parti →</button>
			{:else if step.id === 'preambule'}
				<h2 class="mb-1 text-lg font-bold">📖 Préambule</h2>
				<p class="mb-4 text-sm text-gray-600">Bienvenue au hackerspace ! Avant d’aller plus loin, deux règles d’or.</p>
				<div class="mb-5 space-y-4 text-sm text-gray-700">
					<div class="border-l-4 border-lghs-yellow pl-3">
						<p class="mb-1 font-bold text-black">1. Sois excellent·e envers les autres</p>
						<p>
							Respect, bienveillance et patience. On vient tous d’horizons différents, avec des niveaux
							différents, et tout le monde a été débutant·e un jour. Une question n’est jamais bête, et
							une explication donnée avec le sourire vaut mieux qu’une remarque sèche.
						</p>
					</div>
					<div class="border-l-4 border-lghs-yellow pl-3">
						<p class="mb-1 font-bold text-black">2. La règle des 110 %</p>
						<p>
							Fais ta part, et un peu plus. Il n’y a aucun employé au hackerspace : tout est géré par
							les membres, pour les membres. Une poubelle pleine, un outil qui traîne, une machine à
							nettoyer, quelqu’un qui cherche son chemin ? Pas besoin d’attendre que quelqu’un d’autre
							s’en occupe : c’est à toi de jouer.
						</p>
					</div>
					<p>
						Le hackerspace, c’est ce qu’on en fait ensemble : propose tes idées, partage ce que tu sais,
						demande quand tu ne sais pas, et laisse l’atelier un peu mieux que tu ne l’as trouvé.
					</p>
				</div>
				<button type="button" onclick={next} class="btn-primary px-5 py-2.5 text-sm">J’ai compris →</button>
			{:else if step.id === 'infos'}
				<h2 class="mb-1 text-lg font-bold">🪪 Mon profil</h2>
				<p class="mb-4 text-sm text-gray-600">Vérifie et complète tes informations : elles servent au hackerspace pour te joindre.</p>
				<form method="POST" action="?/updateProfile" use:enhance={afterSave((v) => (savingProfile = v), 'success', 'error')} class="space-y-3 text-sm">
					<div class="grid grid-cols-2 gap-3">
						<label class="block">
							<span class="mb-1 block font-bold uppercase">Prénom</span>
							<input name="firstName" bind:value={firstName} required class="w-full border border-black px-3 py-2" />
						</label>
						<label class="block">
							<span class="mb-1 block font-bold uppercase">Nom</span>
							<input name="lastName" bind:value={lastName} required class="w-full border border-black px-3 py-2" />
						</label>
					</div>
					<label class="block">
						<span class="mb-1 block font-bold uppercase">Téléphone</span>
						<input name="phoneNumber" value={attr('phoneNumber')} required inputmode="tel" placeholder="32470000000" class="w-full border border-black px-3 py-2 placeholder:text-gray-300" />
					</label>
					<label class="block">
						<span class="mb-1 block font-bold uppercase">Rue et numéro</span>
						<input name="street" value={attr('street')} required class="w-full border border-black px-3 py-2" />
					</label>
					<div class="grid grid-cols-[6rem_1fr] gap-3">
						<label class="block">
							<span class="mb-1 block font-bold uppercase">Code postal</span>
							<input name="postal_code" value={attr('postal_code')} required class="w-full border border-black px-3 py-2" />
						</label>
						<label class="block">
							<span class="mb-1 block font-bold uppercase">Localité</span>
							<input name="locality" value={attr('locality')} required class="w-full border border-black px-3 py-2" />
						</label>
					</div>
					<label class="block">
						<span class="mb-1 block font-bold uppercase">Pays</span>
						<input name="country" value={attr('country') || 'Belgique'} required class="w-full border border-black px-3 py-2" />
					</label>
					<div>
						<span class="mb-1 block font-bold uppercase">Date de naissance <span class="text-xs font-normal normal-case">(facultative)</span></span>
						<div class="grid grid-cols-[4.5rem_1fr_5.5rem] gap-2">
							<input type="text" inputmode="numeric" maxlength="2" placeholder="Jour" bind:value={birthdayDay} aria-label="Jour" class="w-full border border-black px-3 py-2 placeholder:text-gray-300" />
							<select bind:value={birthdayMonth} aria-label="Mois" class="w-full border border-black bg-white px-2 py-2 {birthdayMonth ? '' : 'text-gray-400'}">
								<option value="">Mois</option>
								{#each MONTHS as month, i (month)}
									<option value={String(i + 1)}>{month}</option>
								{/each}
							</select>
							<input type="text" inputmode="numeric" maxlength="4" placeholder="Année" bind:value={birthdayYear} aria-label="Année (facultative)" class="w-full border border-black px-3 py-2 placeholder:text-gray-300" />
						</div>
						<p class="mt-1 text-xs text-gray-500">L’année est facultative si tu préfères ne partager que le jour et le mois.</p>
						<input type="hidden" name="birthday" value={birthday} />
					</div>
					<label class="flex w-fit items-center gap-3 {hasBirthdayDate ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}">
						<span class="relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors {birthdayAnnounce && hasBirthdayDate ? 'bg-black' : 'bg-gray-300'}">
							<input type="checkbox" name="birthdayAnnounce" bind:checked={birthdayAnnounce} disabled={!hasBirthdayDate} class="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
							<span class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform {birthdayAnnounce && hasBirthdayDate ? 'translate-x-5' : ''}"></span>
						</span>
						Souhaite-moi un bon anniversaire sur le chat !
					</label>
					<button type="submit" disabled={savingProfile} class="btn-primary mt-2 px-5 py-2.5 text-sm disabled:opacity-50">
						{savingProfile ? 'Enregistrement…' : 'Enregistrer et continuer →'}
					</button>
				</form>
			{:else if step.id === 'photo'}
				<h2 class="mb-1 text-lg font-bold">📷 Ta photo de profil</h2>
				<p class="mb-4 text-sm text-gray-600">
					Elle t’identifie sur Passport, le trombinoscope et le chat. Une vraie photo aide les autres
					membres à te reconnaître à l’atelier.
				</p>
				<div class="mb-5">
					<AvatarEditor avatarUrl={data.profile?.avatar ?? null} hasLocalAvatar={data.hasLocalAvatar} />
				</div>
				<button type="button" onclick={next} class="btn-primary px-5 py-2.5 text-sm">
					{data.hasLocalAvatar ? 'Continuer →' : 'Garder mes initiales →'}
				</button>
			{:else if step.id === 'urgence'}
				<h2 class="mb-1 text-lg font-bold">🆘 Contacts d’urgence</h2>
				<p class="mb-4 text-sm text-gray-600">
					Une personne à prévenir si quelque chose t’arrive au hackerspace.
				</p>
				<EmergencyContactsForm
					contacts={data.emergencyContacts}
					maxContacts={data.maxEmergencyContacts}
					{form}
					submitLabel="Enregistrer et continuer →"
					onSaved={next}
				/>
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
				<div class="text-center">
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

	<!-- Arrival: confetti over the whole page, in the hackerspace's colours. -->
	{#if step.id === 'arrivee'}
		<div class="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
			{#each Array.from({ length: 70 }, (_, i) => i) as i (i)}
				<span
					class="confetti absolute -top-4 {i % 3 === 0 ? 'h-3 w-1.5' : 'h-2 w-2'} {i % 2 ? 'bg-lghs-yellow' : 'bg-black'}"
					style="left: {(i * 37) % 100}%; animation-delay: {((i * 7) % 20) / 10}s; animation-duration: {2.2 + (i % 5) * 0.35}s"
				></span>
			{/each}
		</div>
	{/if}

	<!-- Back / skip, except where they make no sense. -->
	{#if index > 0 && index < STEPS.length - 1}
		<div class="mt-3 flex items-center justify-between text-sm">
			<button type="button" onclick={back} class="font-bold text-gray-600 hover:text-black">← Étape précédente</button>
			{#if step.id !== 'roi' && step.id !== 'preambule'}
				<button type="button" onclick={skip} disabled={recalculating} class="font-bold text-gray-600 underline hover:text-black">
					Passer cette étape
				</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.confetti {
		animation-name: fall;
		animation-timing-function: ease-in;
		animation-fill-mode: forwards;
		opacity: 0;
	}
	@keyframes fall {
		0% {
			transform: translateY(-10px) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(105vh) rotate(540deg);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.confetti {
			display: none;
		}
	}
</style>
