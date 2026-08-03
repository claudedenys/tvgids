import { json } from './_json';
import { loadChannels, loadProgrammes, loadSport, allAvailableDates } from '../../lib/store';
import { normalizeText, hitFromProgramme, hitFromSport } from '../../lib/search';
import type { Channel } from '../../lib/types';
import type { SearchHit } from '../../lib/search';

export const prerender = false;

/**
 * Alle uitzendingen van één programma-titel over alle beschikbare dagen.
 * /api/title?q=Familie
 * Wordt gebruikt door de kijklijst: exacte (accent- en hoofdlettervrije) titel-match.
 */
export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const norm = normalizeText(q);
  if (norm.length < 2) {
    return json({ error: 'Geef een titel op.' }, { status: 400 });
  }

  const channels = await loadChannels();
  const byId = new Map(channels.map((c) => [c.id, c]));
  const byName = new Map<string, Channel>();
  for (const c of channels) {
    byName.set(normalizeText(c.name), c);
    byName.set(c.name, c);
  }
  const channelLookup = new Map([...byId, ...byName]);

  const dates = (await allAvailableDates()).sort();
  const airings: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => {
    const key = `${h.channelId}:${h.start}:${normalizeText(h.title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    airings.push(h);
  };

  for (const date of dates) {
    for (const c of channels) {
      if (!c.active) continue;
      const progs = await loadProgrammes(c.id, date);
      for (const p of progs) {
        if (normalizeText(p.title) === norm) push(hitFromProgramme(c, date, p));
      }
    }
    const sport = await loadSport(date);
    for (const e of sport) {
      if (normalizeText(e.title) === norm) push(hitFromSport(e, date, channelLookup));
    }
  }

  airings.sort((a, b) => a.start - b.start);
  return json({ q, count: airings.length, airings });
}
