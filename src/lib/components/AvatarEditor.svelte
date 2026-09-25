<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/toast.svelte';
	import { avatarSize } from '$lib/avatar';

	let {
		avatarUrl,
		hasLocalAvatar
	}: {
		// The avatar currently shown everywhere: the uploaded photo if there is one, Gravatar otherwise.
		avatarUrl: string | null;
		hasLocalAvatar: boolean;
	} = $props();

	// Crop viewport on screen, and the size of the JPEG actually sent — must match the server's
	// AVATAR_SIZE (src/lib/server/avatars.ts), which rejects anything else.
	const VIEW = 240;
	const OUTPUT = 256;
	// Server-side cap is 200 KB; a 256px JPEG is typically 15-40 KB, so this only kicks in for
	// unusually noisy photos, by lowering the quality until it fits.
	const MAX_BYTES = 200 * 1024;
	const MAX_ZOOM = 4;
	const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

	let fileInput = $state<HTMLInputElement | null>(null);
	let uploadForm = $state<HTMLFormElement | null>(null);

	// Crop state: the picked image, drawn at `scale` (px on screen per source px) and shifted by
	// (offsetX, offsetY) inside the square viewport. Always clamped so the image covers the whole
	// square — no empty band can end up in the saved photo.
	let imageSrc = $state<string | null>(null);
	let image = $state<HTMLImageElement | null>(null);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	let zoom = $state(1);
	let offsetX = $state(0);
	let offsetY = $state(0);
	let busy = $state(false);
	let croppedBlob: Blob | null = null;

	const baseScale = $derived(naturalWidth && naturalHeight ? VIEW / Math.min(naturalWidth, naturalHeight) : 1);
	const scale = $derived(baseScale * zoom);

	function clampOffsets(x: number, y: number) {
		offsetX = Math.min(0, Math.max(VIEW - naturalWidth * scale, x));
		offsetY = Math.min(0, Math.max(VIEW - naturalHeight * scale, y));
	}

	function pickFile() {
		fileInput?.click();
	}

	function handleFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			showToast('error', 'Choisissez un fichier image.');
			return;
		}
		if (file.size > MAX_SOURCE_BYTES) {
			showToast('error', 'Image trop lourde (20 Mo maximum).');
			return;
		}
		// A data: URL rather than an object URL, so the preview keeps working under a CSP whose
		// img-src allows data: but not blob:.
		const reader = new FileReader();
		reader.onload = () => {
			imageSrc = reader.result as string;
		};
		reader.readAsDataURL(file);
	}

	function handleImageLoad() {
		if (!image) return;
		naturalWidth = image.naturalWidth;
		naturalHeight = image.naturalHeight;
		zoom = 1;
		// Centered to start with.
		clampOffsets((VIEW - naturalWidth * baseScale) / 2, (VIEW - naturalHeight * baseScale) / 2);
	}

	function handleImageError() {
		showToast('error', "Impossible de lire cette image.");
		cancel();
	}

	// Zooms around the viewport's center rather than its top-left corner, so the part of the photo
	// being framed stays in place.
	function setZoom(next: number) {
		const previousScale = scale;
		const centerX = (VIEW / 2 - offsetX) / previousScale;
		const centerY = (VIEW / 2 - offsetY) / previousScale;
		zoom = next;
		clampOffsets(VIEW / 2 - centerX * scale, VIEW / 2 - centerY * scale);
	}

	let drag: { pointerId: number; startX: number; startY: number; fromX: number; fromY: number } | null = null;

	function handlePointerDown(event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, fromX: offsetX, fromY: offsetY };
	}

	function handlePointerMove(event: PointerEvent) {
		if (!drag || drag.pointerId !== event.pointerId) return;
		clampOffsets(drag.fromX + event.clientX - drag.startX, drag.fromY + event.clientY - drag.startY);
	}

	function handlePointerUp(event: PointerEvent) {
		if (drag?.pointerId === event.pointerId) drag = null;
	}

	// Keyboard framing for anyone not using a mouse or touch screen.
	function handleKeydown(event: KeyboardEvent) {
		const step = event.shiftKey ? 20 : 5;
		const moves: Record<string, [number, number]> = {
			ArrowLeft: [step, 0],
			ArrowRight: [-step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step]
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		clampOffsets(offsetX + move[0], offsetY + move[1]);
	}

	function cancel() {
		imageSrc = null;
		naturalWidth = 0;
		naturalHeight = 0;
		croppedBlob = null;
	}

	function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
		return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
	}

	async function confirmCrop() {
		if (!image) return;
		busy = true;
		const canvas = document.createElement('canvas');
		canvas.width = OUTPUT;
		canvas.height = OUTPUT;
		const context = canvas.getContext('2d')!;
		// JPEG has no transparency — a transparent PNG would otherwise come out with a black background.
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, OUTPUT, OUTPUT);
		context.imageSmoothingQuality = 'high';
		context.drawImage(image, -offsetX / scale, -offsetY / scale, VIEW / scale, VIEW / scale, 0, 0, OUTPUT, OUTPUT);

		let blob: Blob | null = null;
		for (const quality of [0.9, 0.8, 0.7, 0.6]) {
			blob = await toJpeg(canvas, quality);
			if (blob && blob.size <= MAX_BYTES) break;
		}
		if (!blob || blob.size > MAX_BYTES) {
			busy = false;
			showToast('error', "Impossible de préparer l'image.");
			return;
		}
		croppedBlob = blob;
		uploadForm?.requestSubmit();
	}
</script>

<div class="mb-6">
	<div class="flex items-center gap-4">
		{#if avatarUrl}
			<img src={avatarSize(avatarUrl, 128)} alt="" class="h-16 w-16 shrink-0 object-cover" />
		{/if}
		<div class="text-sm">
			{#if hasLocalAvatar}
				<p>Votre photo de profil est affichée partout sur Passport, y compris dans le trombinoscope.</p>
			{:else}
				<p>
					Votre photo vient de <a href="https://gravatar.com" target="_blank" rel="noopener">Gravatar</a>,
					via votre adresse email. Vous pouvez aussi envoyer votre propre photo.
				</p>
			{/if}
			<div class="mt-2 flex flex-wrap gap-2">
				<button type="button" onclick={pickFile} class="btn-primary px-3 py-1.5 text-xs">
					{hasLocalAvatar ? 'Changer la photo' : 'Envoyer une photo'}
				</button>
				{#if hasLocalAvatar}
					<form
						method="POST"
						action="?/deleteAvatar"
						use:enhance={() =>
							async ({ result, update }) => {
								await update();
								if (result.type === 'success') showToast('success', 'Photo supprimée, retour à Gravatar.');
							}}
					>
						<button
							type="submit"
							class="border border-black px-3 py-1.5 text-xs font-bold uppercase transition-colors hover:bg-black hover:text-white"
						>
							Supprimer la photo
						</button>
					</form>
				{/if}
			</div>
		</div>
	</div>

	<input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={handleFile} />

	<form
		bind:this={uploadForm}
		method="POST"
		action="?/uploadAvatar"
		enctype="multipart/form-data"
		class="hidden"
		use:enhance={({ formData, cancel: cancelSubmit }) => {
			if (!croppedBlob) {
				cancelSubmit();
				return;
			}
			formData.set('avatar', croppedBlob, 'avatar.jpg');
			return async ({ result, update }) => {
				await update();
				busy = false;
				if (result.type === 'success') {
					showToast('success', 'Photo de profil enregistrée.');
					cancel();
				} else if (result.type === 'failure') {
					showToast('error', (result.data?.avatarError as string | undefined) ?? "L'envoi a échoué.");
				} else if (result.type === 'error') {
					showToast('error', "L'envoi a échoué.");
				}
			};
		}}
	></form>
</div>

{#if imageSrc}
	<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4" role="presentation">
		<div class="w-full max-w-sm border border-black bg-white p-4" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title">
			<h2 id="avatar-crop-title" class="mb-3 text-base font-bold uppercase">Recadrer la photo</h2>
			<p class="mb-3 text-xs text-gray-600">Faites glisser l'image pour la cadrer, et zoomez avec le curseur.</p>

			<!-- A button so it's focusable and keyboard-operable (arrow keys pan the photo). -->
			<button
				type="button"
				class="relative mx-auto block cursor-move touch-none overflow-hidden border border-black bg-gray-100 p-0 select-none"
				style="width: {VIEW}px; height: {VIEW}px;"
				aria-label="Zone de recadrage, flèches du clavier pour déplacer"
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
				onkeydown={handleKeydown}
			>
				<img
					bind:this={image}
					src={imageSrc}
					alt=""
					draggable="false"
					onload={handleImageLoad}
					onerror={handleImageError}
					class="pointer-events-none absolute max-w-none"
					style="left: {offsetX}px; top: {offsetY}px; width: {naturalWidth * scale}px; height: {naturalHeight * scale}px;"
				/>
			</button>

			<label class="mt-4 block text-xs font-bold uppercase" for="avatar-zoom">Zoom</label>
			<input
				id="avatar-zoom"
				type="range"
				min="1"
				max={MAX_ZOOM}
				step="0.01"
				value={zoom}
				oninput={(event) => setZoom(Number((event.currentTarget as HTMLInputElement).value))}
				class="w-full"
			/>

			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					onclick={cancel}
					disabled={busy}
					class="border border-black px-4 py-2 text-sm font-bold uppercase transition-colors hover:bg-black hover:text-white"
				>
					Annuler
				</button>
				<button type="button" onclick={confirmCrop} disabled={busy} class="btn-primary px-4 py-2 text-sm">
					{busy ? 'Envoi…' : 'Enregistrer'}
				</button>
			</div>
		</div>
	</div>
{/if}
