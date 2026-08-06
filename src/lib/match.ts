/**
 * Zuivere zoek-/matchlogica (browser-safe, geen node-imports).
 *
 * Gedeeld door de statische frontend (EpgApp) en de server-zijde zoekfuncties
 * in `search.ts`. Eén bron van waarheid voor "koers = wielrennen = tour".
 */
import type { Programme, SearchHit, SportEvent, SportStatus } from './types';

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

/** Stopwoorden: komen te vaak voor om nuttig te zijn als zoekterm. */
const STOPWORDS = new Set(['de', 'het', 'een', 'en', 'in', 'van', 'op', 'aan', 'met', 'voor', 'bij', 'naar']);

/** Normaliseer tekst: kleine letters, diakritische tekens verwijderd. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

/** Splits een zoekopdracht in genormaliseerde woorden (zonder stopwoorden). */
export function queryWords(q: string): string[] {
  return q
    .split(/\s+/)
    .map(normalizeText)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
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

export function hitExcluded(h: SearchHit, ex: SearchConstraints): boolean {
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

/** Rangorde: 2 = titel-match, 1 = alleen omschrijving/categorie, 0 = geen. */
export function titleMatchRank(h: SearchHit, tokens: string[]): number {
  const title = normalizeText(h.title);
  if (tokens.some((t) => title.includes(t))) return 2;
  if (h.competition && normalizeText(h.competition).split(/\s+/).some((w) => tokens.includes(w))) return 1;
  return 1;
}

/** Voorkom dubbele resultaten: zelfde zender + start + titel. */
export function hitKey(h: SearchHit): string {
  return `${h.channelId}:${h.start}:${normalizeText(h.title)}`;
}

/**
 * Filter een (statische) zoekindex op een zoekopdracht.
 * Client-zijde equivalent van de vroegere zoek-API.
 *
 * Drie stadia, telkens strenger:
 * 1. Exacte term: titel is exact gelijk aan de zoekterm.
 * 2. Titel-match: de term komt voor in de titel (vb. "Ronde van Vlaanderen").
 * 3. Ruime match: de term komt ergens voor (titel, omschrijving, categorie, ...).
 * Een stadium stopt zodra het resultaten oplevert.
 */
export function filterSearchIndex(hits: SearchHit[], q: string, date?: string): SearchHit[] {
  const tokens = searchTokens(q);
  const constraints = constraintsFor(q);
  const exactTitle = normalizeText(q);

  function collect(pred: (h: SearchHit) => boolean, seen: Set<string>): SearchHit[] {
    const out: SearchHit[] = [];
    for (const h of hits) {
      if (date && h.date !== date) continue;
      if (hitExcluded(h, constraints)) continue;
      if (!pred(h)) continue;
      const key = hitKey(h);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out;
  }

  // Stadium 1: exacte term.
  const seen = new Set<string>();
  let out = collect((h) => normalizeText(h.title) === exactTitle, seen);
  if (out.length > 0) {
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  // Stadium 2: term in de titel.
  const titleTokens = tokens.filter((t) => t.length >= 2);
  out = collect((h) => titleTokens.some((t) => normalizeText(h.title).includes(t)), seen);
  if (out.length > 0) {
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  // Stadium 3: ruime substring-match over alle velden.
  out = collect(
    (h) => matchesText([h.title, h.description, h.category.join(' '), h.competition, h.home, h.away], tokens),
    seen,
  );
  out.sort((a, b) => {
    const at = titleMatchRank(a, tokens);
    const bt = titleMatchRank(b, tokens);
    if (at !== bt) return bt - at;
    return a.start - b.start;
  });
  return out;
}

/** Alle uitzendingen van één titel (accent-/hoofdlettervrije exacte match), gesorteerd op tijd. */
export function airingsForTitle(hits: SearchHit[], title: string): SearchHit[] {
  const norm = normalizeText(title);
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    if (normalizeText(h.title) !== norm) continue;
    const key = hitKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export type { SearchHit, SportStatus };
