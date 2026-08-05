/**
 * Genereert de statische data voor de build in `public/data/`.
 *
 * Leest de bestandsgebaseerde store (`data/`) en schrijft:
 *  - public/data/meta.json          — availableDates, tijdzone, updatedAt
 *  - public/data/channels.json      — ChannelWithStatus[] (alle zenders + status)
 *  - public/data/epg/<date>.json    — EpgResponse per beschikbare dag
 *  - public/data/search.json        — SearchHit[] over alle dagen (client-zijde zoeken)
 *  - public/data/status.json        — status-snapshot voor de admin-pagina
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadChannels,
  loadStatus,
  loadProgrammes,
  loadSport,
  allAvailableDates,
  readLog,
  listProgrammeDays,
} from '../src/lib/store';
import { hitFromProgramme, hitFromSport } from '../src/lib/search';
import { normalizeText, hitKey } from '../src/lib/match';
import { APP_TIMEZONE } from '../src/lib/config';
import type { Channel, ChannelWithStatus, EpgResponse, SearchHit } from '../src/lib/types';
import type { StatusFile } from '../src/lib/store';

const OUT_DIR = path.join(process.cwd(), 'public', 'data');

function withStatus(channels: Channel[], status: StatusFile): ChannelWithStatus[] {
  return channels.map((c) => ({
    ...c,
    status: status.channels[c.id] ?? {
      channelId: c.id,
      epgAvailable: false,
      lastUpdate: null,
      lastError: null,
      programmesCount: 0,
      daysAvailable: 0,
      descriptionAvailable: false,
      lastDate: null,
      firstDate: null,
    },
  }));
}

async function main(): Promise<void> {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUT_DIR, 'epg'), { recursive: true });

  const [channels, status] = await Promise.all([loadChannels(), loadStatus()]);
  const active = channels.filter((c) => c.active);
  const channelsWithStatus = withStatus(channels, status);
  const dates = (await allAvailableDates()).sort();

  const byId = new Map(channels.map((c) => [c.id, c]));
  const byName = new Map<string, Channel>();
  for (const c of channels) {
    byName.set(normalizeText(c.name), c);
    byName.set(c.name, c);
  }
  const channelLookup = new Map([...byId, ...byName]);

  // --- per-dag EpgResponse -------------------------------------------------
  const searchHits: SearchHit[] = [];
  for (const date of dates) {
    const programmes: EpgResponse['programmes'] = [];
    const warnings: EpgResponse['warnings'] = [];
    const dayHits: SearchHit[] = [];
    const seen = new Set<string>();

    for (const c of active) {
      const progs = await loadProgrammes(c.id, date);
      if (progs.length === 0) {
        const cs = status.channels[c.id];
        warnings.push({
          channelId: c.id,
          message: cs?.epgAvailable
            ? 'EPG beschikbaar, maar geen gegevens voor deze datum.'
            : 'Geen gratis EPG-bron beschikbaar.',
        });
      }
      programmes.push(...progs);
      for (const p of progs) {
        const h = hitFromProgramme(c, date, p);
        const key = hitKey(h);
        if (seen.has(key)) continue;
        seen.add(key);
        dayHits.push(h);
      }
    }

    const sport = await loadSport(date);
    programmes.sort((a, b) => a.start - b.start);
    for (const e of sport) {
      const h = hitFromSport(e, date, channelLookup);
      const key = hitKey(h);
      if (seen.has(key)) continue;
      seen.add(key);
      dayHits.push(h);
    }

    const response: EpgResponse = {
      date,
      now: Date.now(),
      timezone: APP_TIMEZONE,
      channels: channelsWithStatus,
      programmes,
      sport,
      warnings,
      availableDates: dates,
    };
    await writeFile(path.join(OUT_DIR, 'epg', `${date}.json`), JSON.stringify(response), 'utf8');
    searchHits.push(...dayHits);
  }

  // --- zoekindex -----------------------------------------------------------
  await writeFile(path.join(OUT_DIR, 'search.json'), JSON.stringify(searchHits), 'utf8');

  // --- meta -----------------------------------------------------------------
  const updatedAt = status.sources['telenet.tv']?.lastUpdate ?? new Date().toISOString();
  await writeFile(
    path.join(OUT_DIR, 'meta.json'),
    JSON.stringify({ availableDates: dates, timezone: APP_TIMEZONE, updatedAt }),
    'utf8',
  );

  // --- channels -------------------------------------------------------------
  await writeFile(path.join(OUT_DIR, 'channels.json'), JSON.stringify(channelsWithStatus), 'utf8');

  // --- status-snapshot (equivalent van de oude /api/status) ------------------
  const log = await readLog(100);
  const missingDescriptions: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const c of channels) {
    let total = 0;
    let missing = 0;
    const days = await listProgrammeDays(c.id);
    for (const d of days) {
      const progs = await loadProgrammes(c.id, d);
      total += progs.length;
      missing += progs.filter((p) => !p.description && !/geen uitzending/i.test(p.title)).length;
    }
    totals[c.id] = total;
    missingDescriptions[c.id] = missing;
  }
  await writeFile(
    path.join(OUT_DIR, 'status.json'),
    JSON.stringify({
      now: new Date().toISOString(),
      channels: channels.length,
      activeChannels: active.length,
      sources: status.sources,
      channelStatus: status.channels,
      totals,
      missingDescriptions,
      log,
      dataDir: 'data/',
      static: true,
    }),
    'utf8',
  );

  console.log(
    `Statische data gegenereerd: ${dates.length} dagen, ${searchHits.length} zoekitems, ` +
      `${active.length}/${channels.length} actieve zenders → ${OUT_DIR}`,
  );
}

main().catch((err) => {
  console.error('Fout bij genereren van statische data:', err);
  process.exit(1);
});
