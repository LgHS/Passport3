#!/usr/bin/env node
// Compares .env against .env.example so that a missing/renamed/empty variable shows up as a
// visible warning right when someone runs `pnpm dev`/`pnpm build`, instead of failing silently
// deep inside requireEnv() the first time that specific code path runs (or being swallowed by a
// try/catch, as happened with DOLIBARR_API_KEY vs DOLIBARR_API_TOKEN).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseEnvFile(path) {
	if (!existsSync(path)) return null;

	const entries = new Map();
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;

		entries.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
	}
	return entries;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const example = parseEnvFile(resolve(root, '.env.example'));
const local = parseEnvFile(resolve(root, '.env'));

if (!example) {
	// Nothing to check against — don't block whatever script called this.
	process.exit(0);
}

if (!local) {
	console.warn('\n⚠️  check-env: pas de fichier .env à la racine du projet.');
	console.warn('   Copie .env.example vers .env et remplis les valeurs.\n');
	process.exit(0);
}

const missing = [...example.keys()].filter((key) => !local.has(key));
const empty = [...example.keys()].filter((key) => local.has(key) && local.get(key) === '');
const undocumented = [...local.keys()].filter((key) => !example.has(key));

if (missing.length === 0 && empty.length === 0 && undocumented.length === 0) {
	process.exit(0);
}

console.warn('\n⚠️  check-env: .env a divergé de .env.example\n');
if (missing.length > 0) {
	console.warn(`   Absentes de .env           : ${missing.join(', ')}`);
}
if (empty.length > 0) {
	console.warn(`   Présentes mais vides       : ${empty.join(', ')}`);
}
if (undocumented.length > 0) {
	console.warn(`   Dans .env mais pas documentées dans .env.example (typo ? renommage ?) :`);
	console.warn(`     ${undocumented.join(', ')}`);
}
console.warn('');
