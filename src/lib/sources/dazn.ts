/**
 * Adapter voor de officiële DAZN BE-programmatie.
 *
 * Bron: de openbare (anonieme) EPG-API achter de DAZN-schedule-pagina
 * (https://www.dazn.com/nl-BE/schedule). Geen login vereist.
 *   - https://epg.discovery.indazn.com/eu/v5/epgWithDatesRange?country=be&languageCode=nl&...
 *
 * DAZN BE is een streamingdienst: de data is event-gebaseerd (elke uitzending
 * is een eigen "stream"), niet per lineair kanaal. Daarom worden events via
 * een heuristiek op de 6 DAZN-kanalen van de gids gelegd:
 *  - Jupiler Pro League-wedstrijden  → DAZN Pro League 1/2/3
 *  - Overige sport                   → DAZN 1/2/3
 * In de UI worden die blokken met een eigen omlijning aangeduid omdat de
 * uitzending niet noodzakelijk op dat specifieke kanaal te zien is.
 */
import type { Channel, Programme } from '../types';
import { tzOffsetMs, brusselsDateKey } from '../normalise';
import { fetchWithRetry } from '../util';

export const DAZN_SOURCE = 'dazn.com' as const;

const EPG_URL = 'https://epg.discovery.indazn.com/eu/v5/epgWithDatesRange';
const IMAGE_URL = 'https://image.discovery.indazn.com/eu/v3/eu/none';

/** Kanaal-ids per groep (voor de heuristische toewijzing). */
export const DAZN_MAIN_CHANNELS = ['dazn1', 'dazn2', 'dazn3'] as const;
export const DAZN_PROLEAGUE_CHANNELS = ['dazn-jpl1', 'dazn-jpl2', 'dazn-jpl3'] as const;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface DaznTile {
  Id?: string;
  Title?: string;
  Description?: string;
  Start?: string | null;
  End?: string | null;
  Image?: { Id?: string } | null;
  Competition?: { Title?: string } | null;
  Sport?: { Title?: string } | null;
}

interface DaznEvent {
  id: string;
  title: string;
  description: string | null;
  competition: string | null;
  sport: string | null;
  image: string | null;
  start: number;
  end: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Haal alle events van één Brussels dag op uit de DAZN EPG-API. */
export async function fetchDaznEvents(dayStart: number, dayEnd: number): Promise<DaznEvent[]> {
  const dayKey = brusselsDateKey(dayStart);
  if (!DATE_RE.test(dayKey)) return [];
  const params = new URLSearchParams({
    country: 'be',
    languageCode: 'nl',
    openBrowse: 'true',
    timeZoneOffset: String(Math.round(tzOffsetMs(new Date(dayStart)) / 60000)),
    startDate: dayKey,
    endDate: dayKey,
    brand: 'dazn',
  });
  const res = await fetchWithRetry(`${EPG_URL}?${params}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
  }, { timeoutMs: 30000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} voor DAZN-EPG ${dayKey}`);
  const data = (await res.json()) as { Tiles?: DaznTile[] };
  const tiles = Array.isArray(data.Tiles) ? data.Tiles : [];

  const events: DaznEvent[] = [];
  for (const t of tiles) {
    const startMs = t.Start ? Date.parse(t.Start) : NaN;
    if (!Number.isFinite(startMs)) continue;
    // Doorlopende gratis kanalen (Rally TV, NFL Network, …) hebben een
    // start in het verleden en/of een eindtijd in het jaar 3000 → overslaan.
    if (t.End && /^3000/.test(t.End)) continue;
    if (startMs < dayStart) continue;
    if (startMs >= dayEnd) continue;
    const title = t.Title?.trim();
    if (!title) continue;

    events.push({
      id: t.Id ?? title,
      title,
      description: t.Description?.trim() || null,
      competition: t.Competition?.Title?.trim() || null,
      sport: t.Sport?.Title?.trim() || null,
      image: t.Image?.Id ? imageUrl(t.Image.Id) : null,
      start: startMs,
      end: estimateEnd(startMs, t),
    });
  }
  events.sort((a, b) => a.start - b.start);
  return events;
}

function imageUrl(id: string): string {
  return `${IMAGE_URL}/${encodeURIComponent(id)}/fill/none/top/none/80/334/187/webp/image?brand=dazn`;
}

/** Geschatte duur wanneer DAZN geen eindtijd meegeeft (live sport). */
function estimateEnd(start: number, t: DaznTile): number {
  if (t.End) {
    const end = Date.parse(t.End);
    if (Number.isFinite(end) && end > start) return end;
  }
  const hay = `${t.Title ?? ''} ${t.Competition?.Title ?? ''} ${t.Sport?.Title ?? ''} ${t.Description ?? ''}`;
  let minutes = 180; // standaard ~3 uur
  if (/voetbal|soccer|pro league|jupiler|premier league|champions league|la liga|serie a|bundesliga|eredivisie/i.test(hay)) minutes = 135;
  else if (/golf/i.test(hay)) minutes = 300;
  else if (/boksen|boxing|mma|vechtsport/i.test(hay)) minutes = 90;
  else if (/tennis/i.test(hay)) minutes = 150;
  return start + minutes * 60000;
}

function isProLeague(ev: DaznEvent): boolean {
  return /pro league|jupiler/i.test(`${ev.competition ?? ''} ${ev.title} ${ev.description ?? ''}`);
}

/**
 * Wijs events toe aan kanalen binnen een groep (zonder overlap waar mogelijk).
 * Events worden chronologisch op de eerste vrije zender geplaatst; wanneer alle
 * zenders bezet zijn, op de zender die het langst vrij is.
 */
function assign(channelIds: string[], events: DaznEvent[]): Map<string, DaznEvent[]> {
  const out = new Map<string, DaznEvent[]>();
  const lastEnd = new Map<string, number>();
  for (const id of channelIds) {
    out.set(id, []);
    lastEnd.set(id, Number.NEGATIVE_INFINITY);
  }
  for (const ev of events) {
    const free = channelIds.filter((id) => (lastEnd.get(id) ?? 0) <= ev.start);
    let pick: string;
    if (free.length) {
      // strakst passen op de zender die het kortst geleden vrij kwam
      pick = free.reduce((a, b) => ((lastEnd.get(a) ?? 0) >= (lastEnd.get(b) ?? 0) ? a : b));
    } else {
      // alles bezet → uitzenden op de zender die het langst vrij is
      pick = channelIds.reduce((a, b) => ((lastEnd.get(a) ?? 0) <= (lastEnd.get(b) ?? 0) ? a : b));
    }
    out.get(pick)!.push(ev);
    lastEnd.set(pick, ev.end);
  }
  return out;
}

/**
 * Importeer één Brussels dag voor alle DAZN-kanalen tegelijk.
 * Retourneert per kanaal-id de toegewezen programma's.
 */
export async function importDaznDay(
  channels: Channel[],
  dayStart: number,
  dayEnd: number,
): Promise<Map<string, Programme[]>> {
  const daznChannels = channels.filter((c) => c.sources.some((s) => s.source === DAZN_SOURCE));
  if (!daznChannels.length) return new Map();
  const daznIds = daznChannels.filter((c) => DAZN_MAIN_CHANNELS.includes(c.id as (typeof DAZN_MAIN_CHANNELS)[number])).map((c) => c.id);
  const jplIds = daznChannels.filter((c) => DAZN_PROLEAGUE_CHANNELS.includes(c.id as (typeof DAZN_PROLEAGUE_CHANNELS)[number])).map((c) => c.id);
  const unknown = daznChannels.filter((c) => !DAZN_MAIN_CHANNELS.includes(c.id as (typeof DAZN_MAIN_CHANNELS)[number]) && !DAZN_PROLEAGUE_CHANNELS.includes(c.id as (typeof DAZN_PROLEAGUE_CHANNELS)[number]));
  for (const c of unknown) console.warn(`DAZN: zender ${c.id} zit in geen enkele toewijzingsgroep → overgeslagen`);

  const events = await fetchDaznEvents(dayStart, dayEnd);
  const jplEvents = events.filter(isProLeague);
  const mainEvents = events.filter((e) => !isProLeague(e));

  const jplAssignment = assign(jplIds, jplEvents);
  const mainAssignment = assign(daznIds, mainEvents);

  const result = new Map<string, Programme[]>();
  for (const id of daznIds) result.set(id, mainAssignment.get(id)!.map((ev) => buildProgramme(ev, id)));
  for (const id of jplIds) result.set(id, jplAssignment.get(id)!.map((ev) => buildProgramme(ev, id)));
  return result;
}

function buildProgramme(ev: DaznEvent, channelId: string): Programme {
  const description = ev.competition ? `${ev.competition}\n${ev.description ?? ''}`.trim() : ev.description;
  return {
    id: `${channelId}:${ev.start}:${ev.id}`,
    channel: channelId,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    description,
    category: ev.sport ? [ev.sport] : ['Sport'],
    image: ev.image,
    icon: null,
    source: DAZN_SOURCE,
    season: null,
    episode: null,
    actors: [],
    live: true,
    meta: {
      dazn: true,
      eventId: ev.id,
      competition: ev.competition,
      sport: ev.sport,
      episodeName: ev.title,
    },
  };
}
