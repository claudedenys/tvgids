/**
 * Adapter voor de gratis openbare EPG van telenet.tv (Belgische zenders).
 *
 * Bron: openbare JSON-API's van Telenet Belgium die ook door het
 * open-source project iptv-org/epg gebruikt worden.
 *  - EPG-segmenten:  https://staticqbr-prod-be.gnp.cloud.telenet.tv/.../epg-service-lite/be
 *  - Programmadetails: https://spark-prod-be.gnp.cloud.telenet.tv/.../linear-service/v2
 *  - Afbeeldingen:    https://staticqbr-prod-be.gnp.cloud.telenet.tv/image-service
 */
import type { Programme, Channel } from '../types';
import { toProgramme } from '../normalise';
import { pMap, fetchWithRetry } from '../util';

const EPG_SERVICE = 'https://staticqbr-prod-be.gnp.cloud.telenet.tv/eng/web/epg-service-lite/be';
const LINEAR_SERVICE = 'https://spark-prod-be.gnp.cloud.telenet.tv/eng/web/linear-service/v2';
const IMAGE_SERVICE = 'https://staticqbr-prod-be.gnp.cloud.telenet.tv/image-service';

export const TELENET_SOURCE = 'telenet.tv' as const;

export interface TelenetEvent {
  id: string;
  startTime: number;
  endTime: number;
  title: string;
}

interface TelenetDetail {
  longDescription?: string;
  shortDescription?: string;
  episodeName?: string;
  genres?: string[];
  seasonNumber?: number | string;
  episodeNumber?: number | string;
  actors?: string[];
  title?: string;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function getJson(url: string, timeoutMs = 20000): Promise<unknown> {
  const res = await fetchWithRetry(
    url,
    { headers: { 'user-agent': UA, accept: 'application/json' } },
    { timeoutMs },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}`);
  return res.json();
}

function segUrl(dateUTC: Date, hour: '000000' | '060000' | '120000' | '180000', lang: string): string {
  const y = dateUTC.getUTCFullYear();
  const m = String(dateUTC.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateUTC.getUTCDate()).padStart(2, '0');
  return `${EPG_SERVICE}/${lang}/events/segments/${y}${m}${d}${hour}`;
}

/** Haal alle segmenten van één UTC-dag op en retourneer events per channelId. */
export async function fetchDaySegments(dateUTC: Date, lang = 'nl'): Promise<Map<string, TelenetEvent[]>> {
  const hours: Array<'000000' | '060000' | '120000' | '180000'> = ['000000', '060000', '120000', '180000'];
  const map = new Map<string, TelenetEvent[]>();
  const results = await pMap(hours, async (h) => {
    try {
      const data = (await getJson(segUrl(dateUTC, h, lang))) as { entries?: { channelId: string; events: TelenetEvent[] }[] };
      return data.entries ?? [];
    } catch (err) {
      console.warn(`telenet segment ${h} mislukt:`, (err as Error).message);
      return [];
    }
  }, 2);
  for (const entries of results) {
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.events)) continue;
      const existing = map.get(entry.channelId) ?? [];
      existing.push(...entry.events);
      map.set(entry.channelId, existing);
    }
  }
  return map;
}

export async function fetchEventDetail(eventId: string, lang = 'nl'): Promise<TelenetDetail> {
  try {
    const data = (await getJson(
      `${LINEAR_SERVICE}/replayEvent/${encodeURIComponent(eventId)}?returnLinearContent=true&language=${lang}`,
    )) as TelenetDetail;
    return data;
  } catch {
    return {};
  }
}

export function posterUrl(eventId: string): string {
  return `${IMAGE_SERVICE}/intent/${encodeURIComponent(eventId)}/posterTile`;
}

/**
 * Haal de zenderlijst van Telenet op (id → naam/logo).
 * Gebruikt voor het invullen van logo's in de centrale configuratie.
 */
export async function fetchTelenetChannels(): Promise<{ site_id: string; name: string; logo: string }[]> {
  const data = (await getJson(
    `${LINEAR_SERVICE}/channels?cityId=28001&language=en&productClass=Orion-DASH`,
    30000,
  )) as { id: string; name: string; logo?: { focused?: string } }[];
  if (!Array.isArray(data)) return [];
  return data.map((c) => ({ site_id: c.id, name: c.name, logo: c.logo?.focused ?? '' }));
}

/**
 * Importeer een dag voor één Telenet-zender.
 * `segments` is de gecachete Map van fetchDaySegments.
 */
export async function importChannelDay(
  channel: Channel,
  dayStart: number,
  dayEnd: number,
  segments: Map<string, TelenetEvent[]>,
  lang = 'nl',
): Promise<Programme[]> {
  const src = channel.sources.find((s) => s.source === TELENET_SOURCE);
  if (!src) return [];
  const events = segments.get(src.site_id) ?? [];
  // Segmenten overlappen elkaar → ontdubbel op start+einde.
  const seen = new Set<string>();
  const unique: TelenetEvent[] = [];
  for (const e of events) {
    const key = `${e.startTime}:${e.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  const programmes: Programme[] = [];
  for (const ev of unique.sort((a, b) => a.startTime - b.startTime)) {
    const start = ev.startTime * 1000;
    const end = ev.endTime * 1000;
    if (end <= dayStart || start >= dayEnd) continue;
    const isPlaceholder = /geen uitzending/i.test(ev.title || '');
    let detail: TelenetDetail = {};
    if (!isPlaceholder) {
      detail = await fetchEventDetail(ev.id, lang);
    }
    const p = toProgramme(channel.id, {
      title: ev.title,
      start,
      end,
      source: TELENET_SOURCE,
      description: detail.longDescription || detail.shortDescription || null,
      category: Array.isArray(detail.genres) ? detail.genres : [],
      season: detail.seasonNumber ? Number(detail.seasonNumber) || null : null,
      episode: detail.episodeNumber ? Number(detail.episodeNumber) || null : null,
      image: isPlaceholder ? null : posterUrl(ev.id),
      meta: { eventId: ev.id },
    });
    if (p) programmes.push(p);
  }
  return programmes;
}
