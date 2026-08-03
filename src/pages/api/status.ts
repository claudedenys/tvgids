import { json } from './_json';
import { loadChannels, loadStatus, loadSport, readLog, listProgrammeDays } from '../../lib/store';

export const prerender = false;

export async function GET(): Promise<Response> {
  const [channels, status] = await Promise.all([loadChannels(), loadStatus()]);
  const log = await readLog(100);

  // Ontbrekende omschrijvingen per zender (voor de admin/debug-pagina).
  const missingDescriptions: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const c of channels) {
    let total = 0;
    let missing = 0;
    const days = await listProgrammeDays(c.id);
    for (const d of days) {
      const { loadProgrammes } = await import('../../lib/store');
      const progs = await loadProgrammes(c.id, d);
      total += progs.length;
      missing += progs.filter((p) => !p.description && !/geen uitzending/i.test(p.title)).length;
    }
    totals[c.id] = total;
    missingDescriptions[c.id] = missing;
  }

  return json({
    now: new Date().toISOString(),
    channels: channels.length,
    activeChannels: channels.filter((c) => c.active).length,
    sources: status.sources,
    channelStatus: status.channels,
    totals,
    missingDescriptions,
    log,
    dataDir: process.env.DATA_DIR ?? 'data/',
  });
}
