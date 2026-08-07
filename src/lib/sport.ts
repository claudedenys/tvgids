/**
 * Sport-integratie.
 *
 * Sportwedstrijden verschijnen als afzonderlijke items in de EPG-tijdlijn.
 *
 * Vrije bronnen die op dit moment gebruikt worden:
 *  - De EPG zelf: op DAZN- en Play Sports-kanalen staan echte wedstrijd-uitzendingen.
 *    De wedstrijdnaam staat in het detail-veld episodeName/seriesName
 *    (bv. "Club Brugge - Anderlecht"), de titel is de competitie (bv. "Jupiler Pro League").
 *    Daaruit worden sportevenementen afgeleid (teams, competitie, sportsoort,
 *    status via tijdstip).
 *
 * De architectuur is zo dat later een aparte gratis sportfeed (bv. een
 * openbare wedstrijdkalender-API) als bron toegevoegd kan worden zonder de
 * frontend aan te passen. Zie interface SportSource.
 */
import type { Programme, Channel, SportEvent } from './types';

export const SPORT_CHANNEL_IDS = new Set([
  'playsports1',
  'playsports2',
  'playsports3',
  'playsports4',
  'playsports-premierleague',
  'playsports-golf',
  'playsports-open',
  'dazn1',
  'dazn2',
  'dazn3',
  'dazn-jpl1',
  'dazn-jpl2',
  'dazn-jpl3',
]);

export interface SportSource {
  id: string;
  /** Haal sportevenementen op voor een Brussels dag. */
  fetchDay(dayStart: number, dayEnd: number): Promise<SportEvent[]>;
}

/**
 * Leid sportevenementen af uit EPG-programma's op sportzenders.
 * Gebruikt alleen échte EPG-data; er wordt niets verzonnen.
 *
 * Wedstrijden (titel met "Thuisploeg – Uitploeg") die op meerdere zenders
 * tegelijk uitgezonden worden, worden gebundeld tot één evenement met
 * `channels`/`channelIds` voor alle zenders. Overige events (placeholders,
 * magazines) blijven per zender apart.
 */
export function deriveSportEvents(programmes: Programme[], channels: Channel[]): SportEvent[] {
  const channelNames = new Map<string, string>();
  for (const c of channels) channelNames.set(c.id, c.name);

  interface MatchGroup {
    title: string;
    home: string | null;
    away: string | null;
    competition: string | null;
    sport: string | null;
    description: string | null;
    start: number;
    end: number;
    source: string;
    status: SportEvent['status'];
    items: { channel: string; name: string }[];
  }
  const matchGroups = new Map<string, MatchGroup>();
  const singles: SportEvent[] = [];

  const now = Date.now();

  for (const p of programmes) {
    if (!SPORT_CHANNEL_IDS.has(p.channel)) continue;
    const title = p.title.trim();
    if (!title || /geen uitzending/i.test(title)) continue;

    // De echte wedstrijdnaam staat in episodeName/seriesName,
    // bv. "Manchester United - Nottingham Forest" (titel is dan "Premier League").
    const meta = p.meta as
      | { episodeName?: string; seriesName?: string; genres?: string[] }
      | undefined;
    const matchTitle = meta?.episodeName ?? meta?.seriesName ?? title;
    const teams = parseTeams(matchTitle);
    const name = channelNames.get(p.channel) ?? p.channel;

    const competition = detectCompetition(title, p.description);
    const sport = detectSportType(meta?.genres ?? [], `${title} ${p.description ?? ''}`, competition);
    const status: SportEvent['status'] = now < p.start ? 'aankomend' : now < p.end ? 'live' : 'afgelopen';

    const base = {
      id: `sport:${p.id}`,
      externalId: null,
      title: matchTitle,
      home: teams?.home ?? null,
      away: teams?.away ?? null,
      competition,
      sport,
      start: p.start,
      end: p.end,
      status,
      description: p.description,
      source: 'epg',
    };

    if (teams) {
      const key = `${normalizeText(matchTitle)}\u0001${p.start}\u0001${p.end}`;
      const g = matchGroups.get(key);
      if (g) {
        g.items.push({ channel: p.channel, name });
      } else {
        matchGroups.set(key, {
          title: matchTitle,
          home: teams.home,
          away: teams.away,
          competition,
          sport,
          description: p.description,
          start: p.start,
          end: p.end,
          source: 'epg',
          status,
          items: [{ channel: p.channel, name }],
        });
      }
    } else {
      singles.push({ ...base, platforms: [name], channels: [name], channelIds: [p.channel] });
    }
  }

  const events: SportEvent[] = singles;
  for (const g of matchGroups.values()) {
    const uniqueNames: string[] = [];
    const uniqueIds: string[] = [];
    for (const it of g.items) {
      if (!uniqueNames.includes(it.name)) uniqueNames.push(it.name);
      if (!uniqueIds.includes(it.channel)) uniqueIds.push(it.channel);
    }
    events.push({
      id: `sport:match:${g.start}:${normalizeText(g.title)}`,
      externalId: null,
      title: g.title,
      home: g.home,
      away: g.away,
      competition: g.competition,
      sport: g.sport,
      start: g.start,
      end: g.end,
      status: g.status,
      description: g.description,
      source: g.source,
      platforms: uniqueNames,
      channels: uniqueNames,
      channelIds: uniqueIds,
    });
  }
  return events;
}

function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const BROADCAST_SUFFIX = /(?:\s+(?:live|herhaling|highlights|replay|full match|samenvatting|extra time|voorbeschouwing)\s*)$/i;

/** Herken "Thuisploeg – Uitploeg" in de titel. */
function parseTeams(title: string): { home: string; away: string } | null {
  const m = title.match(/^(.*?)\s*[–—-]\s*(.*?)(?:\s+\d+\s*[–:]\s*\d+)?$/);
  if (!m) return null;
  const home = m[1].trim().replace(BROADCAST_SUFFIX, '').trim();
  const away = m[2].trim().replace(BROADCAST_SUFFIX, '').trim();
  if (!home || !away) return null;
  if (home.length < 2 || away.length < 2) return null;
  return { home, away };
}

const SPORT_TYPES: { names: string[]; label: string }[] = [
  { names: ['voetbal', 'soccer'], label: 'Voetbal' },
  { names: ['wielrennen', 'cycling', 'veldrijden', 'velodroom'], label: 'Wielrennen' },
  { names: ['tennis'], label: 'Tennis' },
  { names: ['basketbal', 'basketball'], label: 'Basketbal' },
  { names: ['golf'], label: 'Golf' },
  { names: ['formule 1', 'formule 2', 'formule 3', 'autosport', 'motorsport', 'moto gp', 'mxgp'], label: 'Motorsport' },
  { names: ['volleybal'], label: 'Volleybal' },
  { names: ['handbal', 'handball'], label: 'Handbal' },
  { names: ['ijshockey', 'hockey'], label: 'Hockey' },
  { names: ['rugby'], label: 'Rugby' },
  { names: ['darts'], label: 'Darts' },
  { names: ['snooker', 'biljart', 'pool'], label: 'Biljart' },
  { names: ['boksen', 'boxing'], label: 'Boksen' },
  { names: ['mma', 'vechtsport'], label: 'Vechtsport' },
  { names: ['atletiek'], label: 'Atletiek' },
  { names: ['padel'], label: 'Padel' },
  { names: ['korfbal'], label: 'Korfbal' },
  { names: ['paardensport'], label: 'Paardensport' },
];

const FOOTBALL = /jupiler|pro league|premier league|bundesliga|la liga|serie a|ligue 1|eredivisie|champions league|europa league|conference league|beker van belgi|supercup|voetbal|soccer/i;

/** Bepaal de sportsoort via genres (telenet) of via titel/omschrijving. */
function detectSportType(genres: string[], haystack: string, competition: string | null): string | null {
  const genreText = genres.map((g) => g.toLowerCase()).join(' ');
  if (genreText) {
    for (const s of SPORT_TYPES) {
      if (s.names.some((n) => genreText.includes(n))) return s.label;
    }
  }
  const lower = haystack.toLowerCase();
  for (const s of SPORT_TYPES) {
    if (s.names.some((n) => lower.includes(n))) return s.label;
  }
  // Sommige events hebben enkel genre "Sport"/"Competitiesporten" en een
  // competitienaam als titel. Bekende voetbalcompetities → Voetbal.
  if (competition && FOOTBALL.test(competition)) return 'Voetbal';
  return null;
}

const COMPETITIONS: { re: RegExp; name: string }[] = [
  { re: /jupiler pro league|pro league|challenger pro league/i, name: 'Jupiler Pro League' },
  { re: /belgian first division/i, name: 'Jupiler Pro League' },
  { re: /premier league/i, name: 'Premier League' },
  { re: /champions league|uefa champions/i, name: 'UEFA Champions League' },
  { re: /europa league|uefa europa/i, name: 'UEFA Europa League' },
  { re: /conference league/i, name: 'UEFA Conference League' },
  { re: /eredivisie/i, name: 'Eredivisie' },
  { re: /la liga|primera divisi/i, name: 'La Liga' },
  { re: /bundesliga/i, name: 'Bundesliga' },
  { re: /serie a/i, name: 'Serie A' },
  { re: /lotto kings cup|beker van belgi/i, name: 'Beker van België' },
  { re: /formule 1|f1/i, name: 'Formule 1' },
  { re: /tennis/i, name: 'Tennis' },
  { re: /cycling|wielren/i, name: 'Wielrennen' },
];

function detectCompetition(title: string, description: string | null): string | null {
  const haystack = `${title} ${description ?? ''}`;
  for (const c of COMPETITIONS) {
    if (c.re.test(haystack)) return c.name;
  }
  return null;
}

/** API voor een eventueel externe sportbron (toekomst). */
export async function runSportSources(
  sources: SportSource[],
  dayStart: number,
  dayEnd: number,
): Promise<SportEvent[]> {
  const out: SportEvent[] = [];
  for (const s of sources) {
    try {
      out.push(...(await s.fetchDay(dayStart, dayEnd)));
    } catch (err) {
      console.warn(`sportbron ${s.id} mislukt:`, (err as Error).message);
    }
  }
  return out;
}
