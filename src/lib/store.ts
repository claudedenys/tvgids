/**
 * Eenvoudige bestandsgebaseerde "database".
 *
 * Doelbewust bewust gehouden als JSON-bestanden zodat de app werkt op gratis
 * hosting zonder externe database. De interfaces zijn zo opgezet dat een
 * SQLite/PostgreSQL-implementatie later dezelfde functies kan vervullen.
 */
import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DATA_DIR,
  EPG_DIR,
  SPORT_DIR,
  CHANNELS_FILE,
  STATUS_FILE,
  LOG_FILE,
} from './config';
import { dateKey } from './constants';
import type { Channel, ChannelStatus, LogEntry, Programme, SourceStatus, SportEvent } from './types';

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

/* ------------------------------------------------------------------ */
/* Zenders                                                              */
/* ------------------------------------------------------------------ */

export async function loadChannels(): Promise<Channel[]> {
  return readJson<Channel[]>(CHANNELS_FILE, []);
}

export async function saveChannels(channels: Channel[]): Promise<void> {
  await writeJson(CHANNELS_FILE, channels);
}

/* ------------------------------------------------------------------ */
/* EPG-programma's per zender per dag                                   */
/* ------------------------------------------------------------------ */

export async function loadProgrammes(channelId: string, day: string): Promise<Programme[]> {
  return readJson<Programme[]>(path.join(EPG_DIR, channelId, `${day}.json`), []);
}

export async function saveProgrammes(channelId: string, day: string, programmes: Programme[]): Promise<void> {
  await writeJson(path.join(EPG_DIR, channelId, `${day}.json`), programmes);
}

/** Alle dagen waarvoor programma's voor een zender bestaan. */
export async function listProgrammeDays(channelId: string): Promise<string[]> {
  try {
    const dir = path.join(EPG_DIR, channelId);
    const entries = await import('node:fs/promises').then((m) => m.readdir(dir));
    return entries.filter((e) => e.endsWith('.json')).map((e) => e.replace(/\.json$/, '')).sort();
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Sportevenementen per dag                                             */
/* ------------------------------------------------------------------ */

export async function loadSport(day: string): Promise<SportEvent[]> {
  return readJson<SportEvent[]>(path.join(SPORT_DIR, `${day}.json`), []);
}

export async function saveSport(day: string, events: SportEvent[]): Promise<void> {
  await writeJson(path.join(SPORT_DIR, `${day}.json`), events);
}

/* ------------------------------------------------------------------ */
/* Status                                                               */
/* ------------------------------------------------------------------ */

export interface StatusFile {
  sources: Record<string, SourceStatus>;
  channels: Record<string, ChannelStatus>;
}

export async function loadStatus(): Promise<StatusFile> {
  return readJson<StatusFile>(STATUS_FILE, { sources: {}, channels: {} });
}

export async function saveStatus(status: StatusFile): Promise<void> {
  await writeJson(STATUS_FILE, status);
}

/** Status van alle zenders samenvoegen met het zenderbestand. */
export async function loadChannelsWithStatus(): Promise<{ channels: Channel[]; statuses: Record<string, ChannelStatus> }> {
  const [channels, status] = await Promise.all([loadChannels(), loadStatus()]);
  return { channels, statuses: status.channels };
}

/* ------------------------------------------------------------------ */
/* Logboek                                                              */
/* ------------------------------------------------------------------ */

export async function appendLog(entry: Omit<LogEntry, 'ts'>): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n', 'utf8');
  } catch {
    // logging mag nooit de import breken
  }
}

export async function readLog(limit = 500): Promise<LogEntry[]> {
  try {
    const raw = await readFile(LOG_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as LogEntry);
  } catch {
    return [];
  }
}

/** Beschikbare dagen over de hele EPG-store (voor datumkiezer). */
export async function allAvailableDates(): Promise<string[]> {
  const { channels } = await loadChannelsWithStatus();
  const set = new Set<string>();
  for (const c of channels) {
    const days = await listProgrammeDays(c.id);
    for (const d of days) set.add(d);
  }
  return [...set].sort();
}

export function utcDateKey(d: Date): string {
  return dateKey(d);
}
