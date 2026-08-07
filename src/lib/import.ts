/**
 * EPG-import: haalt echte EPG-data van de gratis bronnen, normaliseert,
 * ontdubbelt en schrijft naar de store. Bij een mislukte bron blijven
 * vorige geldige gegevens behouden (er wordt enkel bij succes weggeschreven).
 */
import type { Channel, Programme, SourceId } from './types';
import { DEFAULT_IMPORT_DAYS } from './config';
import { brusselsDayStart, brusselsDayEnd, dedupeProgrammes, brusselsDateKey } from './normalise';
import {
  loadChannels,
  saveChannels,
  saveProgrammes,
  saveSport,
  loadStatus,
  saveStatus,
  appendLog,
  listProgrammeDays,
  loadProgrammes,
} from './store';
import { fetchDaySegments, importChannelDay as importTelenetDay, fetchTelenetChannels, makeDetailCache } from './sources/telenet';
import { importChannelDay as importTvgidsDay } from './sources/tvgids';
import { importDaznDay, DAZN_SOURCE } from './sources/dazn';
import { deriveSportEvents } from './sport';

export interface ImportResult {
  start: string;
  end: string;
  days: number;
  channels: number;
  programmes: number;
  errors: { channelId: string; source: string; message: string }[];
  durationMs: number;
}

interface TelenetCache {
  get(dateStr: Date): Promise<Map<string, { id: string; startTime: number; endTime: number; title: string }[]>>;
}

/** Caches segmenten per UTC-dag zodat een range-import ze maar één keer ophaalt. */
function makeTelenetCache() {
  const cache = new Map<string, Promise<Map<string, { id: string; startTime: number; endTime: number; title: string }[]>>>();
  const get = (date: Date): Promise<Map<string, { id: string; startTime: number; endTime: number; title: string }[]>> => {
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (!cache.has(key)) cache.set(key, fetchDaySegments(date));
    return cache.get(key)!;
  };
  return { get };
}

export async function importRange(opts: {
  start?: string;
  days?: number;
  channelIds?: string[];
} = {}): Promise<ImportResult> {
  const t0 = Date.now();
  const errors: ImportResult['errors'] = [];

  const channels = (await loadChannels()).filter((c) => c.active);
  const selected = opts.channelIds?.length ? channels.filter((c) => opts.channelIds!.includes(c.id)) : channels;
  if (!selected.length) throw new Error('Geen actieve zenders gevonden in de catalogus.');

  const startKey = opts.start ?? brusselsDateKey(new Date());
  const days = opts.days ?? DEFAULT_IMPORT_DAYS;
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const dayStart = brusselsDayStart(startKey) + i * 24 * 60 * 60 * 1000;
    dates.push(brusselsDateKey(dayStart));
  }

  const telenetCache = makeTelenetCache();
  const detailCache = makeDetailCache();
  let total = 0;

  for (const dayKey of dates) {
    const dayStart = brusselsDayStart(dayKey);
    const dayEnd = brusselsDayEnd(dayKey);

    // 1) Telenet-zenders: één segment-fetch per UTC-dag, daarna per zender details.
    const telenetChannels = selected.filter((c) => c.sources.some((s) => s.source === 'telenet.tv'));
    let telenetSegments: Map<string, { id: string; startTime: number; endTime: number; title: string }[]> | null = null;
    if (telenetChannels.length) {
      const d0 = new Date(dayStart);
      const d1 = new Date(dayStart + 24 * 60 * 60 * 1000);
      const [s0, s1] = await Promise.all([telenetCache.get(d0), telenetCache.get(d1)]);
      telenetSegments = new Map([...s0, ...s1]);
    }

    // 1b) DAZN-kanalen: event-gebaseerde programmatie éénmalig per dag ophalen.
    const daznChannels = selected.filter((c) => c.sources.some((s) => s.source === DAZN_SOURCE));
    let daznMap: Map<string, Programme[]> | null = null;
    if (daznChannels.length) {
      daznMap = await importDaznDay(daznChannels, dayStart, dayEnd);
    }

    for (const channel of selected) {
      try {
        let programmes: Programme[] = [];
        const dazn = channel.sources.some((s) => s.source === DAZN_SOURCE);
        const telenet = channel.sources.find((s) => s.source === 'telenet.tv');
        const tvgids = channel.sources.find((s) => s.source === 'tvgids.nl');

        if (dazn && daznMap) {
          programmes = daznMap.get(channel.id) ?? [];
        } else if (telenet && telenetSegments) {
          programmes = await importTelenetDay(channel, dayStart, dayEnd, telenetSegments, 'nl', detailCache);
        } else if (tvgids) {
          const r = await importTvgidsDay(channel, dayKey, dayStart, dayEnd);
          programmes = r.programmes;
          if (r.logo && channel.logo !== r.logo) {
            channel.logo = r.logo;
            await saveChannels(channels);
          }
        }

        programmes = dedupeProgrammes(programmes).sort((a, b) => a.start - b.start);
        await saveProgrammes(channel.id, dayKey, programmes);
        total += programmes.length;
      } catch (err) {
        const msg = (err as Error).message;
        errors.push({ channelId: channel.id, source: channel.sources[0]?.source ?? '?', message: msg });
        await appendLog({
          level: 'error',
          source: channel.sources[0]?.source ?? 'system',
          message: `Import mislukt voor ${channel.id} op ${dayKey}: ${msg}`,
          channelId: channel.id,
        });
      }
    }

    // 2) Sportevenementen afleiden uit sportzenders.
    const sportChannels = selected.filter((c) => c.group === 'sport');
    if (sportChannels.length) {
      const all: Programme[] = [];
      for (const c of sportChannels) all.push(...(await loadProgrammes(c.id, dayKey)));
      const events = deriveSportEvents(all, channels);
      await saveSport(dayKey, events);
    }
  }

  // 3) Logos voor Belgische zenders bijwerken via de Telenet-zenderlijst.
  try {
    const telenetList = await fetchTelenetChannels();
    if (telenetList.length) {
      const byId = new Map(telenetList.map((c) => [c.site_id, c.logo]));
      let changed = false;
      for (const c of channels) {
        const src = c.sources.find((s) => s.source === 'telenet.tv');
        if (src && byId.get(src.site_id) && c.logo !== byId.get(src.site_id)) {
          c.logo = byId.get(src.site_id)!;
          changed = true;
        }
      }
      if (changed) await saveChannels(channels);
    }
  } catch (err) {
    errors.push({ channelId: '*', source: 'telenet.tv', message: `Logo-fetch mislukt: ${(err as Error).message}` });
  }

  // 4) Status bijwerken.
  await updateStatus(selected, dates);

  const durationMs = Date.now() - t0;
  await appendLog({
    level: 'info',
    source: 'system',
    message: `Import klaar: ${dates.length} dag(en), ${selected.length} zender(s), ${total} programma's`,
    programmes: total,
    channels: selected.length,
    durationMs,
  });

  return {
    start: startKey,
    end: dates[dates.length - 1],
    days: dates.length,
    channels: selected.length,
    programmes: total,
    errors,
    durationMs,
  };
}

async function updateStatus(channels: Channel[], dates: string[]): Promise<void> {
  const status = await loadStatus();
  const now = new Date().toISOString();

  for (const c of channels) {
    const days = await listProgrammeDays(c.id);
    const availDays = days.filter((d) => dates.includes(d));
    let count = 0;
    let withDesc = 0;
    for (const d of availDays) {
      const progs = await loadProgrammes(c.id, d);
      count += progs.length;
      withDesc += progs.filter((p) => p.description).length;
    }
    status.channels[c.id] = {
      channelId: c.id,
      epgAvailable: availDays.length > 0,
      lastUpdate: now,
      lastError: null,
      programmesCount: count,
      daysAvailable: availDays.length,
      descriptionAvailable: count > 0 && withDesc === count,
      lastDate: availDays.length ? availDays[availDays.length - 1] : null,
      firstDate: availDays.length ? availDays[0] : null,
    };
  }

  // Per-bron samenvatting.
  const sources: SourceId[] = ['telenet.tv', 'dazn.com', 'tvgids.nl', 'xmltv'];
  for (const src of sources) {
    const bySource = channels.filter((c) => c.sources.some((s) => s.source === src));
    let count = 0;
    for (const c of bySource) count += status.channels[c.id]?.programmesCount ?? 0;
    const prev = status.sources[src];
    status.sources[src] = {
      source: src,
      lastUpdate: now,
      lastSuccess: prev?.lastSuccess ?? now,
      lastError: null,
      ok: bySource.every((c) => status.channels[c.id]?.epgAvailable),
      channels: bySource.length,
      programmes: count,
      days: dates.length,
    };
  }

  await saveStatus(status);
}
