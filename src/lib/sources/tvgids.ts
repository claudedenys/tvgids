/** Adapter voor de gratis publieke TV-gids van tvgids.nl (Nederlandse zenders). */
import type { Programme, Channel } from '../types';
import { toProgramme, brusselsDateKey } from '../normalise';
import { TVGIDS_LOGO_CDN } from '../constants';
import { fetchWithRetry } from '../util';

export const TVGIDS_SOURCE = 'tvgids.nl' as const;

const BASE = 'https://www.tvgids.nl/gids/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface RawProgram {
  start: number;
  end: number;
  title: string;
  description: string;
  image: string | null;
  labels: string[];
}

/** Decodeer HTML-entiteiten. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function clean(s: string): string {
  return decodeEntities(s.replace(/\s+/g, ' ').trim());
}

/** Parse één tvgids.nl dagpagina naar programma's. */
export function parseGuidePage(html: string): RawProgram[] {
  const out: RawProgram[] = [];
  // Elke dagpagina bevat <div class="...program..."> blokken met daarin
  // een <span class="program__progress" data-start="..." data-eind="...">.
  const blocks = html.split(/(?=<div[^>]*class="[^"]*\bprogram\b[^"]*")/);
  for (const block of blocks) {
    const m = block.match(/data-start="(\d+)" data-eind="(\d+)"/);
    if (!m) continue;
    const titleMatch = block.match(/class="program__title">\s*([\s\S]*?)</);
    if (!titleMatch) continue;
    const descMatch = block.match(/class="program__text">\s*([\s\S]*?)\s*<\/p>/);
    const imgMatch = block.match(/class="program__thumbnail"[^>]*data-src="([^"]+)"/);
    const labels = Array.from(new Set(block.matchAll(/label--([a-z]+)/g).map((x) => x[1])));
    out.push({
      start: Number(m[1]) * 1000,
      end: Number(m[2]) * 1000,
      title: clean(titleMatch[1]),
      description: descMatch ? clean(descMatch[1]) : '',
      image: imgMatch ? imgMatch[1].startsWith('http') ? imgMatch[1] : null : null,
      labels,
    });
  }
  return out;
}

/** Extract het zenderlogo (tvgidsassets.nl) uit een dagpagina. */
export function parseChannelLogo(html: string): string | null {
  const m = html.match(
    /guide__channel-logo-container[^>]*>[\s\S]{0,800}?data-src="(https:\/\/tvgidsassets\.nl\/[^"]+)"/,
  );
  if (m) return m[1];
  const m2 = html.match(/data-src="(https:\/\/tvgidsassets\.nl\/[^"]+)"/);
  return m2 ? m2[1] : null;
}

function toDatePath(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  return `${d}-${m}-${y}`;
}

/** Importeer één dag voor één tvgids.nl-zender. */
export async function importChannelDay(
  channel: Channel,
  dayKey: string,
  dayStart: number,
  dayEnd: number,
): Promise<{ programmes: Programme[]; logo: string | null }> {
  const src = channel.sources.find((s) => s.source === TVGIDS_SOURCE);
  if (!src) return { programmes: [], logo: null };
  const isToday = dayKey === brusselsDateKey(new Date());
  const url = `${BASE}${isToday ? '' : `${toDatePath(dayKey)}/`}${src.site_id}`;
  const res = await fetchWithRetry(url, { headers: { 'user-agent': UA } }, { timeoutMs: 20000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const raw = parseGuidePage(html);
  const programmes: Programme[] = [];
  for (const r of raw) {
    if (r.end <= dayStart || r.start >= dayEnd) continue;
    const p = toProgramme(channel.id, {
      title: r.title,
      start: r.start,
      end: r.end,
      source: TVGIDS_SOURCE,
      description: r.description || null,
      category: r.labels.includes('sport') ? ['Sport'] : r.labels.includes('actueel') ? ['Actueel'] : [],
      image: r.image,
      live: r.labels.includes('live'),
      meta: { labels: r.labels },
    });
    if (p) programmes.push(p);
  }
  return { programmes, logo: parseChannelLogo(html) };
}

/** Logo-URL voor een tvgids-zender via de gratis tvgidsassets CDN (nummer = site_id). */
export function tvgidsLogo(siteNumber: string): string {
  return `${TVGIDS_LOGO_CDN}/${siteNumber}.png`;
}
