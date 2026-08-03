import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_TIMEZONE, DEFAULT_IMPORT_DAYS } from './constants';

/** Loopt omhoog tot de projectroot (map met package.json), ongeacht bundel-locatie. */
function findRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

/** Basis van de tv-gids applicatie (ook wanneer vanuit dist/ gedraaid). */
export const ROOT_DIR = findRoot(path.dirname(fileURLToPath(import.meta.url)));

/** Map waarin de "database" (JSON-bestanden) staat. Kan overschreven worden via DATA_DIR. */
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');

export const EPG_DIR = path.join(DATA_DIR, 'epg');
export const SPORT_DIR = path.join(DATA_DIR, 'sport');
export const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
export const STATUS_FILE = path.join(DATA_DIR, 'status.json');
export const LOG_FILE = path.join(DATA_DIR, 'log.jsonl');

export { APP_TIMEZONE, DEFAULT_IMPORT_DAYS };
