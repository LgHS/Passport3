// Checks the environment once, at startup, instead of letting a missing variable surface as a 500
// on whichever page happens to need it first. Called from hooks.server.ts.
//
// Pure on purpose: it takes the environment as an argument and returns a report, so
// tests/envCheck.test.ts can cover it without touching the real process environment, and so the
// decision to log or to refuse to start stays in hooks.server.ts.

// Nothing works without these: no login, or no database. A missing one stops the server rather
// than letting every request fail in its own way.
//
// POSTGRES_HOST and POSTGRES_PORT are absent on purpose — db.ts defaults them to localhost:5432,
// which is right for local development. DATA_DIR likewise defaults to `data`.
export const REQUIRED_ENV = [
	'AUTHENTIK_ISSUER',
	'AUTHENTIK_CLIENT_ID',
	'AUTHENTIK_CLIENT_SECRET',
	'AUTHENTIK_REDIRECT_URI',
	'AUTHENTIK_API_TOKEN',
	'PUBLIC_AUTHENTIK_ADMIN_GROUP',
	'POSTGRES_DB',
	'POSTGRES_USER',
	'POSTGRES_PASSWORD'
] as const;

export interface FeatureEnv {
	// What stops working, named as a member would recognise it.
	feature: string;
	vars: string[];
}

// Each of these drives one integration. All of its variables absent means the integration is
// simply not set up, which is a legitimate way to run Passport. **Some** of them absent is a
// misconfiguration, and that is the case worth shouting about: the feature looks configured and
// fails in the middle.
export const FEATURE_ENV: FeatureEnv[] = [
	{ feature: 'Dolibarr (cotisations, factures)', vars: ['DOLIBARR_URL', 'DOLIBARR_API_KEY'] },
	{
		feature: 'Liaison GitHub des membres',
		vars: ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_REDIRECT_URI']
	},
	{
		feature: "Invitations dans l'organisation GitHub",
		vars: [
			'GITHUB_APP_CLIENT_ID',
			'GITHUB_APP_PRIVATE_KEY_BASE64',
			'GITHUB_APP_INSTALLATION_ID',
			'GITHUB_ORG'
		]
	},
	{
		feature: 'Mattermost : lecture des comptes',
		vars: ['MATTERMOST_URL', 'MATTERMOST_TOKEN', 'MATTERMOST_TEAM_SLUG']
	},
	{
		feature: 'Mattermost : annonces et rappels du bot',
		vars: ['MATTERMOST_URL', 'MATTERMOST_BOT_TOKEN', 'MATTERMOST_BOT_ID']
	},
	{
		feature: "Invitations par courriel depuis Authentik",
		vars: ['AUTHENTIK_ENROLLMENT_FLOW_SLUG', 'AUTHENTIK_INVITATION_EMAIL_TEMPLATE']
	}
];

export interface EnvReport {
	// Required variables with no value: the server must not start.
	missing: string[];
	// Integrations configured halfway, with what is missing from each.
	partial: { feature: string; missing: string[] }[];
	// Integrations with nothing set at all: off, and that is fine.
	off: string[];
}

const isSet = (value: string | undefined): boolean => typeof value === 'string' && value.trim() !== '';

export function checkEnv(env: Record<string, string | undefined>): EnvReport {
	const missing = REQUIRED_ENV.filter((name) => !isSet(env[name]));

	const partial: { feature: string; missing: string[] }[] = [];
	const off: string[] = [];
	for (const { feature, vars } of FEATURE_ENV) {
		const absent = vars.filter((name) => !isSet(env[name]));
		if (absent.length === 0) continue;
		if (absent.length === vars.length) off.push(feature);
		else partial.push({ feature, missing: absent });
	}

	return { missing, partial, off };
}

// One block per severity, so a deployment log shows the whole picture at once rather than one line
// per variable scattered through the startup.
export function formatEnvReport(report: EnvReport): string[] {
	const lines: string[] = [];
	if (report.missing.length > 0) {
		lines.push(
			`[env] variables obligatoires manquantes : ${report.missing.join(', ')}. ` +
				'Passport ne peut pas démarrer. Voir .env.example.'
		);
	}
	for (const { feature, missing } of report.partial) {
		lines.push(
			`[env] configuration incomplète — ${feature} : il manque ${missing.join(', ')}. ` +
				'Cette fonctionnalité échouera à l’usage.'
		);
	}
	if (report.off.length > 0) {
		lines.push(`[env] intégrations non configurées, donc inactives : ${report.off.join(' ; ')}.`);
	}
	return lines;
}
