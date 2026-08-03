/** Normalisatie: tijdzones, XMLTV-tijden, unieke sleutels, deduplicatie. */
import type { Programme } from './types';
import { APP_TIMEZONE } from './constants';

/* ------------------------------------------------------------------ */
/* Brussels tijdzone                                                    */
/* ------------------------------------------------------------------ */

const tzFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Offset (ms) van `tz` op een bepaald instant. */
export function tzOffsetMs(date: Date, tz = APP_TIMEZONE): number {
  const parts = tzFormatter.formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asUTC = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), Number(m.hour), Number(m.minute), Number(m.second));
  return asUTC - date.getTime();
}

/** Datumkey (YYYY-MM-DD) in Brussels tijd voor een instant. */
export function brusselsDateKey(instant: number | Date): string {
  const d = new Date(instant);
  const parts = tzFormatter.formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.year}-${m.month}-${m.day}`;
}

function wallToInstant(wallUTC: number): number {
  let inst = wallUTC - tzOffsetMs(new Date(wallUTC));
  inst = wallUTC - tzOffsetMs(new Date(inst));
  return inst;
}

/** Start (ms) van een Brussels dag voor een 'YYYY-MM-DD' key. */
export function brusselsDayStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return wallToInstant(Date.UTC(y, m - 1, d));
}

/** Eind (ms) van een Brussels dag (exclusief). */
export function brusselsDayEnd(key: string): number {
  return brusselsDayStart(key) + 24 * 60 * 60 * 1000;
}

/* ------------------------------------------------------------------ */
/* XMLTV-tijden                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse een XMLTV-tijd: `20260801060000 +0200`.
 * Retourneert epoch ms in UTC, of null bij een ongeldige waarde.
 */
export function parseXmltvTime(value: string): number | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}) ?([+-])(\d{2})(\d{2})?$/);
  if (!m) return null;
  const [, yy, mo, dd, hh, mi, ss, sign, oh, om] = m;
  let utc = Date.UTC(Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  const off = Number(oh) * 60 + Number(om || 0);
  utc -= (sign === '-' ? -1 : 1) * off * 60 * 1000;
  return utc;
}

/* ------------------------------------------------------------------ */
/* Unieke sleutels                                                      */
/* ------------------------------------------------------------------ */

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Stabiele unieke sleutel per programma: channelId + start + titel. */
export function programmeId(channelId: string, start: number, title: string): string {
  return `${channelId}:${start}:${hash(title.trim().toLowerCase())}`;
}

/* ------------------------------------------------------------------ */
/* Deduplicatie                                                         */
/* ------------------------------------------------------------------ */

/**
 * Verwijder overlappende/identieke programma's binnen één dag.
 * Bij identieke start+titel wint de eerste (hoogste prioriteit).
 */
export function dedupeProgrammes(programmes: Programme[]): Programme[] {
  const seen = new Map<string, Programme>();
  for (const p of programmes) {
    const key = `${p.start}:${p.end}:${p.title.trim().toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/** Normaliseer een ruw item naar een Programme. */
export function toProgramme(
  channelId: string,
  raw: {
    title: string;
    start: number;
    end: number;
    description?: string | null;
    category?: string[];
    image?: string | null;
    icon?: string | null;
    source: Programme['source'];
    season?: number | null;
    episode?: number | null;
    actors?: string[];
    live?: boolean;
    meta?: Record<string, unknown>;
  },
): Programme | null {
  const title = raw.title?.trim();
  if (!title || !Number.isFinite(raw.start) || !Number.isFinite(raw.end)) return null;
  if (raw.end <= raw.start) return null;
  return {
    id: programmeId(channelId, raw.start, title),
    channel: channelId,
    title,
    start: raw.start,
    end: raw.end,
    description: raw.description?.trim() ? raw.description : null,
    category: raw.category ?? [],
    image: raw.image || null,
    icon: raw.icon || null,
    source: raw.source,
    season: raw.season ?? null,
    episode: raw.episode ?? null,
    actors: raw.actors ?? [],
    live: raw.live ?? false,
    meta: raw.meta,
  };
}

/** Ontdubbel via externe id (gebruikt door sport- en XMLTV-import). */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()];
}
