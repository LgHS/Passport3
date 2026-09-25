import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import { runMigrations } from '$lib/server/migrations';

// Optional, with a default: unlike requireEnv()'d config, nothing about running Passport locally
// should require setting this up front. In Docker, DB_PATH must point inside the persistent named
// volume declared in docker-compose*.yml, or the file is lost on every Watchtower redeploy.
const DB_PATH = env.DB_PATH || 'data/passport3.db';

// Everything Passport persists on disk lives next to the database, so the single volume mounted on
// DB_PATH's directory (see docker-compose*.yml) also covers uploaded files like avatars.
export const DATA_DIR = dirname(DB_PATH);

let db: Database.Database | null = null;

// Lazy singleton: one connection for the process lifetime, opened on first use rather than at
// module load, so importing this file never has a side effect on its own.
export function getDb(): Database.Database {
	if (!db) {
		const dir = dirname(DB_PATH);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		db = new Database(DB_PATH);
		db.pragma('journal_mode = WAL');
		db.pragma('foreign_keys = ON');
		runMigrations(db);
	}
	return db;
}
