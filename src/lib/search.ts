/**
 * Zoekfunctionaliteit voor de TV-gids.
 *
 * Zoekt op titel + omschrijving + categorie (programma's) en op
 * titel + omschrijving + competitie + teams (sportevenementen).
 *
 * Het "koers = wielrennen = tour"-gedrag komt uit SEARCH_CONTEXTS:
 * een onderhoudbare woordenlijst die een zoekterm uitbreidt naar synoniemen,
 * met per context uitsluitingen (bv. bij wielrennen geen golf/koken/radio/voetbal).
 * Zoeken is keyword-gebaseerd (geen AI/semantiek) en hoofdletter-/accent-vrij.
 */
import type { Channel, Programme, SportEvent, SportStatus } from './types';
import { loadChannels, loadProgrammes, loadSport, allAvailableDates } from './store';
import { programmeId } from './normalise';

/**
 * Eén zoekcontext: uitbreidingen (synoniemen) plus uitsluitingen.
 * `exclude` past substring-match toe op titel/omschrijving/categorie/competitie/teams.
 * `excludeChannels` sluit een heel kanaal uit.
 */
export interface SearchContext {
  terms: string[];
  exclude: string[];
  excludeChannels?: string[];
  excludeCategories?: string[];
}

/** Uitsluitingen bij wielrennen-zoekopdrachten: golf, koken, radio en voetbal. */
const CYCLING_EXCLUDE = [
  // Golf (EPGA/PGA/Tour series/HotelPlanner e.d.)
  'pga', 'epga', 'tour series', 'hotelplanner', 'korn ferry', 'dp world tour',
  'lpga', 'ryder cup',
  // Koken / kookprogramma's
  'chef', 'kook', 'food', 'recept', 'keuken', 'bereidt', 'maaltijd',
  // Radio
  'radio',
  // Voetbal
  'voetbal', 'voetball', 'football', 'eredivisie', 'premier league', 'pro league',
  'champions league', 'europa league', 'conference league', 'bundesliga',
  'serie a', 'la liga', 'ligue 1', 'jupiler', 'vriendenloterij', 'speelronde',
  'play-offs', 'derby', 'ajax', 'feyenoord', 'competitie', 'beker van belgie',
  'beker van nederland', 'supercup', 'ek voetbal', 'wk voetbal', 'uefa',
];

/** Uitbreidingswoordenlijst met per context uitsluitingen. Kan vrij aangevuld worden. */
export const SEARCH_CONTEXTS: Record<string, SearchContext> = {
  koers: {
    terms: [
      'koers', 'wielrennen', 'wieler', 'tour', 'vuelta', 'luik-bastenaken-luik',
      'bastenaken', 'amstel gold race', 'amstel', 'ronde van', 'klassieker',
      'etappe', 'peloton', 'criterium', 'tiroler',
    ],
    exclude: CYCLING_EXCLUDE,
    excludeChannels: ['playsports-golf'],
    excludeCategories: ['kids', 'animatie', "auto's"],
  },
  wielrennen: {
    terms: [
      'wielrennen', 'wieler', 'koers', 'tour', 'vuelta', 'luik-bastenaken-luik',
      'bastenaken', 'amstel gold race', 'amstel', 'ronde van', 'klassieker',
      'etappe', 'peloton', 'criterium',
    ],
    exclude: CYCLING_EXCLUDE,
    excludeChannels: ['playsports-golf'],
    excludeCategories: ['kids', 'animatie', "auto's"],
  },
  voetbal: {
    terms: [
      'voetbal', 'voetball', 'football', 'pro league', 'premier league',
      'champions league', 'europa league', 'conference league', 'eredivisie',
      'jupiler', 'beker', 'kampioenschap', 'wedstrijd', 'derby', 'bundesliga',
    ],
    exclude: [],
  },
  tennis: {
    terms: [
      'tennis', 'atp', 'wta', 'grand slam', 'wimbledon', 'roland garros',
      'us open', 'australian open', 'indian wells', 'finale',
    ],
    exclude: [],
  },
  f1: {
    terms: ['formule 1', 'formula 1', 'f1', 'grand prix', 'gp', 'sprint', 'kwalificatie'],
    exclude: [],
  },
  formule1: {
    terms: ['formule 1', 'formula 1', 'f1', 'grand prix', 'gp', 'sprint', 'kwalificatie'],
    exclude: [],
  },
  basketbal: {
    terms: ['basketbal', 'basketball', 'nba', 'euroleague', 'basket'],
    exclude: [],
  },
  golf: {
    terms: ['golf', 'pga', 'lpga', 'masters', 'ryder cup', 'major'],
    exclude: [],
  },
  darts: {
    terms: ['darts', 'pdc', 'dart'],
    exclude: [],
  },
};

const DIACRITICS = /[\u0300-\u036f]/g;

/** Normaliseer tekst: kleine letters, diakritische tekens verwijderd. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

/** Splits een zoekopdracht in genormaliseerde woorden. */
export function queryWords(q: string): string[] {
  return q
    .split(/\s+/)
    .map(normalizeText)
    .filter((w) => w.length >= 2);
}

/** Context voor één woord (via exacte key of via term); valt terug op undefined. */
export function contextFor(term: string): SearchContext | undefined {
  if (SEARCH_CONTEXTS[term]) return SEARCH_CONTEXTS[term];
  for (const ctx of Object.values(SEARCH_CONTEXTS)) {
    if (ctx.terms.includes(term)) return ctx;
  }
  return undefined;
}

/** Uitbreiding voor één woord; valt terug op het woord zelf. */
export function expansionsFor(term: string): string[] {
  return contextFor(term)?.terms ?? [term];
}

/** Alle zoektokens (synoniemen) voor een zoekopdracht. */
export function searchTokens(q: string): string[] {
  const tokens = new Set<string>();
  for (const w of queryWords(q)) for (const t of expansionsFor(w)) tokens.add(t);
  return [...tokens];
}

/** Uitsluitingen (woorden + kanalen) die voor een zoekopdracht gelden. */
export interface SearchConstraints {
  exclude: Set<string>;
  excludeChannels: Set<string>;
  excludeCategories: Set<string>;
}

export function emptyConstraints(): SearchConstraints {
  return { exclude: new Set(), excludeChannels: new Set(), excludeCategories: new Set() };
}

/** Verzamel de uitsluitingen van alle zoekcontexten die de zoekopdracht raakt. */
export function constraintsFor(q: string): SearchConstraints {
  const ex = emptyConstraints();
  for (const w of queryWords(q)) {
    const ctx = contextFor(w);
    if (!ctx) continue;
    for (const e of ctx.exclude) ex.exclude.add(normalizeText(e));
    for (const c of ctx.excludeChannels ?? []) ex.excludeChannels.add(c);
    for (const cat of ctx.excludeCategories ?? []) ex.excludeCategories.add(normalizeText(cat));
  }
  return ex;
}

function hitExcluded(h: SearchHit, ex: SearchConstraints): boolean {
  if (ex.excludeChannels.has(h.channelId)) return true;
  if (h.category.some((c) => ex.excludeCategories.has(normalizeText(c)))) return true;
  if (ex.exclude.size === 0) return false;
  const hay = normalizeText(
    [h.title, h.description, h.category.join(' '), h.competition, h.home, h.away, h.channelName]
      .filter(Boolean)
      .join(' \u0001 '),
  );
  for (const e of ex.exclude) {
    if (hay.includes(e)) return true;
  }
  return false;
}

function matchesText(fields: (string | null | undefined)[], tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const hay = normalizeText(fields.filter(Boolean).join(' \u0001 '));
  return tokens.some((t) => hay.includes(t));
}

export function programmeMatches(p: Programme, tokens: string[]): boolean {
  return matchesText([p.title, p.description, p.category.join(' ')], tokens);
}

export function sportMatches(e: SportEvent, tokens: string[]): boolean {
  return matchesText([e.title, e.description, e.competition, e.home, e.away], tokens);
}

/** Eén zoekresultaat (gestandaardiseerd voor de API en frontend). */
export interface SearchHit {
  id: string;
  type: 'programme' | 'sport';
  date: string;
  channelId: string;
  channelName: string;
  start: number;
  end: number;
  title: string;
  description: string | null;
  category: string[];
  image: string | null;
  competition?: string | null;
  status?: SportStatus;
  home?: string | null;
  away?: string | null;
  platforms?: string[];
}

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
  const ch = channelLookup.get(e.channels[0] ?? '') ?? channelLookup.get(normalizeText(e.channels[0] ?? ''));
  return {
    id: e.id,
    type: 'sport',
    date,
    channelId: ch?.id ?? e.channels[0] ?? '',
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

/** Rangorde: 2 = titel-match, 1 = alleen omschrijving/categorie, 0 = geen. */
function titleMatchRank(h: SearchHit, tokens: string[]): number {
  const title = normalizeText(h.title);
  if (tokens.some((t) => title.includes(t))) return 2;
  if (h.competition && normalizeText(h.competition).split(/\s+/).some((w) => tokens.includes(w))) return 1;
  return 1;
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
