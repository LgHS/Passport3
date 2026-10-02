import { describe, expect, it } from 'vitest';
import { checkEnv, formatEnvReport, FEATURE_ENV, REQUIRED_ENV } from '$lib/server/envCheck';

// A fully configured environment, built from the lists themselves so adding a variable to
// envCheck.ts can't leave these tests asserting against a stale copy of it.
function fullEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of REQUIRED_ENV) env[name] = 'x';
	for (const { vars } of FEATURE_ENV) for (const name of vars) env[name] = 'x';
	return env;
}

describe('checkEnv', () => {
	it('ne signale rien quand tout est configuré', () => {
		expect(checkEnv(fullEnv())).toEqual({ missing: [], partial: [], off: [] });
	});

	it('signale chaque variable obligatoire absente', () => {
		const env = fullEnv();
		delete env.POSTGRES_PASSWORD;
		delete env.AUTHENTIK_ISSUER;
		expect(checkEnv(env).missing).toEqual(['AUTHENTIK_ISSUER', 'POSTGRES_PASSWORD']);
	});

	it('traite une chaîne vide ou blanche comme absente', () => {
		// Un `POSTGRES_PASSWORD=` dans un .env donne une chaîne vide, pas undefined.
		expect(checkEnv({ ...fullEnv(), POSTGRES_PASSWORD: '' }).missing).toEqual(['POSTGRES_PASSWORD']);
		expect(checkEnv({ ...fullEnv(), POSTGRES_PASSWORD: '   ' }).missing).toEqual(['POSTGRES_PASSWORD']);
	});

	it('n’exige pas ce qui a un défaut dans le code', () => {
		// db.ts rabat POSTGRES_HOST/PORT sur localhost:5432 et DATA_DIR sur `data`.
		for (const name of ['POSTGRES_HOST', 'POSTGRES_PORT', 'DATA_DIR']) {
			expect(REQUIRED_ENV).not.toContain(name);
		}
	});

	it('considère une intégration entièrement absente comme inactive, pas comme une erreur', () => {
		const env = fullEnv();
		for (const name of ['DOLIBARR_URL', 'DOLIBARR_API_KEY']) delete env[name];
		const report = checkEnv(env);
		expect(report.missing).toEqual([]);
		expect(report.partial).toEqual([]);
		expect(report.off).toContain('Dolibarr (cotisations, factures)');
	});

	// Le cas qui justifie tout le découpage : une intégration à moitié configurée a l'air prête et
	// casse en cours de route.
	it('signale une intégration configurée à moitié', () => {
		const env = fullEnv();
		delete env.GITHUB_OAUTH_CLIENT_SECRET;
		const report = checkEnv(env);
		expect(report.partial).toEqual([
			{ feature: 'Liaison GitHub des membres', missing: ['GITHUB_OAUTH_CLIENT_SECRET'] }
		]);
		expect(report.off).toEqual([]);
	});

	it('rattache une variable partagée aux deux intégrations qui en dépendent', () => {
		// MATTERMOST_URL sert à la lecture des comptes et au bot : l'oublier casse les deux.
		const env = fullEnv();
		delete env.MATTERMOST_URL;
		const features = checkEnv(env).partial.map((p) => p.feature);
		expect(features).toEqual([
			'Mattermost : lecture des comptes',
			'Mattermost : annonces et rappels du bot'
		]);
	});

	it('distingue inactif et incomplet dans le même rapport', () => {
		const env = fullEnv();
		for (const name of ['DOLIBARR_URL', 'DOLIBARR_API_KEY']) delete env[name];
		delete env.GITHUB_ORG;
		const report = checkEnv(env);
		expect(report.off).toEqual(['Dolibarr (cotisations, factures)']);
		expect(report.partial).toEqual([
			{ feature: "Invitations dans l'organisation GitHub", missing: ['GITHUB_ORG'] }
		]);
	});

	it('rapporte un environnement complètement vide comme un refus de démarrer', () => {
		const report = checkEnv({});
		expect(report.missing).toEqual([...REQUIRED_ENV]);
		// Rien n'est "incomplet" : tout est absent, donc tout est inactif.
		expect(report.partial).toEqual([]);
		expect(report.off).toHaveLength(FEATURE_ENV.length);
	});
});

describe('formatEnvReport', () => {
	it('ne dit rien quand il n’y a rien à dire', () => {
		expect(formatEnvReport({ missing: [], partial: [], off: [] })).toEqual([]);
	});

	it('nomme les variables manquantes et renvoie vers .env.example', () => {
		const [line] = formatEnvReport({ missing: ['POSTGRES_DB'], partial: [], off: [] });
		expect(line).toContain('POSTGRES_DB');
		expect(line).toContain('.env.example');
	});

	it('nomme la fonctionnalité et ce qui lui manque', () => {
		const [line] = formatEnvReport({
			missing: [],
			partial: [{ feature: 'Liaison GitHub des membres', missing: ['GITHUB_OAUTH_CLIENT_SECRET'] }],
			off: []
		});
		expect(line).toContain('Liaison GitHub des membres');
		expect(line).toContain('GITHUB_OAUTH_CLIENT_SECRET');
	});

	it('met la ligne bloquante en premier', () => {
		const lines = formatEnvReport({
			missing: ['POSTGRES_DB'],
			partial: [{ feature: 'X', missing: ['Y'] }],
			off: ['Z']
		});
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain('obligatoires');
	});
});
