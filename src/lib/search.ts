/**
 * Server-zijde zoekfuncties over de bestandsgebaseerde store.
 *
 * De zuivere matchlogica (contexten, tokens, uitsluitingen) staat in `match.ts`
 * en wordt gedeeld met de statische frontend.
 */
import type { Channel, Programme, SportEvent } from './types';
import { loadChannels, loadProgrammes, loadSport, allAvailableDates } from './store';
import { programmeId } from './normalise';
import {
  normalizeText,
  searchTokens,
  constraintsFor,
  emptyConstraints,
  hitExcluded,
  programmeMatches,
  sportMatches,
  titleMatchRank,
} from './match';
import type { SearchConstraints } from './match';
import type { SearchHit } from './types';

export { normalizeText, searchTokens } from './match';
export type { SearchHit, SearchConstraints } from './match';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function hitFromProgramme(c: Channel, date: string, p: Programme): SearchHit {
  return {
    id: p.id,
    type: 'programme',
    date,
    channelId: c.id,
    channelName: c.name,
    start: p.start,
    end: p.end,
    title: p.title,
    description: p.description,
    category: p.category,
    image: p.image,
  };
}

export function hitFromSport(
  e: SportEvent,
  date: string,
  channelLookup: Map<string, Channel>,
): SearchHit {
  const id = e.channelIds?.[0] ?? e.channels[0] ?? '';
  const ch = channelLookup.get(id) ?? channelLookup.get(normalizeText(id));
  return {
    id: e.id,
    type: 'sport',
    date,
    channelId: ch?.id ?? id,
    channelName: ch?.name ?? e.channels[0] ?? '',
    start: e.start,
    end: e.end,
    title: e.title,
    description: e.description,
    category: [],
    image: null,
    competition: e.competition,
    status: e.status,
    home: e.home,
    away: e.away,
    platforms: e.platforms,
    channelIds: e.channelIds,
    sport: e.sport,
  };
}

/** Zoek één dag (alle actieve zenders). */
export async function searchDay(
  channels: Channel[],
  date: string,
  tokens: string[],
  channelIdFilter?: Set<string>,
  constraints: SearchConstraints = emptyConstraints(),
): Promise<SearchHit[]> {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const byName = new Map<string, Channel>();
  for (const c of channels) {
    byName.set(normalizeText(c.name), c);
    byName.set(c.name, c);
  }
  const channelLookup = new Map([...byId, ...byName]);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => {
    if (hitExcluded(h, constraints)) return;
    // Voorkom dubbele resultaten: zelfde zender + start + titel
    // (bv. een programma én het daaruit afgeleide sportevent).
    const key = `${h.channelId}:${h.start}:${normalizeText(h.title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(h);
  };

  for (const c of channels) {
    if (!c.active) continue;
    if (channelIdFilter && !channelIdFilter.has(c.id)) continue;
    const progs = await loadProgrammes(c.id, date);
    for (const p of progs) {
      if (programmeMatches(p, tokens)) push(hitFromProgramme(c, date, p));
    }
  }
  if (DATE_RE.test(date)) {
    const sport = await loadSport(date);
    for (const e of sport) {
      if (sportMatches(e, tokens)) push(hitFromSport(e, date, channelLookup));
    }
  }

  // Relevantie: titel-match eerst, dan chronologisch.
  hits.sort((a, b) => {
    const at = titleMatchRank(a, tokens);
    const bt = titleMatchRank(b, tokens);
    if (at !== bt) return bt - at;
    return a.start - b.start;
  });
  return hits;
}

/** Zoek over alle beschikbare dagen (beperkt aantal resultaten). */
export async function searchAllDates(
  channels: Channel[],
  tokens: string[],
  maxPerDate = 50,
  maxTotal = 400,
  constraints: SearchConstraints = emptyConstraints(),
): Promise<SearchHit[]> {
  const dates = (await allAvailableDates()).sort();
  const hits: SearchHit[] = [];
  for (const date of dates) {
    const day = await searchDay(channels, date, tokens, undefined, constraints);
    hits.push(...day.slice(0, maxPerDate));
    if (hits.length >= maxTotal) break;
  }
  return hits;
}

/** Hoofdentree voor de zoek-API. */
export async function runSearch(
  q: string,
  date?: string,
  channelIds?: string[],
  opts: { maxPerDate?: number; maxTotal?: number } = {},
): Promise<{ tokens: string[]; date?: string; results: SearchHit[] }> {
  const tokens = searchTokens(q);
  const constraints = constraintsFor(q);
  const channels = await loadChannels();
  const filter = channelIds?.length ? new Set(channelIds) : undefined;
  let results: SearchHit[] = [];
  if (date && DATE_RE.test(date)) {
    results = await searchDay(channels, date, tokens, filter, constraints);
  } else {
    results = await searchAllDates(channels, tokens, opts.maxPerDate, opts.maxTotal, constraints);
  }
  return { tokens, date, results };
}

/** Client-zijde equivalent om een SearchHit naar een Programme te vertalen. */
export function hitToProgramme(hit: SearchHit): Programme {
  return {
    id: hit.id || programmeId(hit.channelId, hit.start, hit.title),
    channel: hit.channelId,
    title: hit.title,
    start: hit.start,
    end: hit.end,
    description: hit.description,
    category: hit.category,
    image: hit.image,
    icon: null,
    source: 'telenet.tv',
    season: null,
    episode: null,
    actors: [],
    live: false,
  };
}
