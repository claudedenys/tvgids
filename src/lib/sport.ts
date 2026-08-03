/**
 * Sport-integratie.
 *
 * Sportwedstrijden verschijnen als afzonderlijke items in de EPG-tijdlijn.
 *
 * Vrije bronnen die op dit moment gebruikt worden:
 *  - De EPG zelf: op DAZN- en Play Sports-kanalen staan echte wedstrijd-uitzendingen
 *    met titels zoals "Club Brugge – Anderlecht". Daaruit worden sportevenementen
 *    afgeleid (teams, competitie via de kanaalnaam, status via tijdstip).
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
 */
export function deriveSportEvents(programmes: Programme[], channels: Channel[]): SportEvent[] {
  const channelNames = new Map<string, string>();
  for (const c of channels) channelNames.set(c.id, c.name);

  const events: SportEvent[] = [];
  for (const p of programmes) {
    if (!SPORT_CHANNEL_IDS.has(p.channel)) continue;
    const title = p.title.trim();
    if (!title || /geen uitzending/i.test(title)) continue;

    const teams = parseTeams(title);
    const platform = channelNames.get(p.channel) ?? p.channel;

    // Competitie herkennen via beschrijving of titel.
    const competition = detectCompetition(title, p.description);

    const now = Date.now();
    const status: SportEvent['status'] = now < p.start ? 'aankomend' : now < p.end ? 'live' : 'afgelopen';

    events.push({
      id: `sport:${p.id}`,
      externalId: null,
      title,
      home: teams?.home ?? null,
      away: teams?.away ?? null,
      competition,
      start: p.start,
      end: p.end,
      status,
      platforms: [platform],
      channels: [platform],
      description: p.description,
      source: 'epg',
    });
  }
  return events;
}

/** Herken "Thuisploeg – Uitploeg" in de titel. */
function parseTeams(title: string): { home: string; away: string } | null {
  const m = title.match(/^(.*?)\s*[–—-]\s*(.*?)(?:\s+\d+\s*[–:]\s*\d+)?$/);
  if (!m) return null;
  const home = m[1].trim();
  const away = m[2].trim();
  if (!home || !away) return null;
  if (home.length < 2 || away.length < 2) return null;
  return { home, away };
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
