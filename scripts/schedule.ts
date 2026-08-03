/**
 * Daemon die de EPG automatisch bijwerkt (elke INTERVAL_MS).
 *
 * Gebruik:
 *   npx tsx scripts/schedule.ts
 * of met cron: 0 3 * * *  cd /pad/naar/tv-gids && npx tsx scripts/import.ts
 */
import { importRange } from '../src/lib/import';
import { appendLog } from '../src/lib/store';

const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 4 * 60 * 60 * 1000); // elke 4 uur
const DAYS = Number(process.env.IMPORT_DAYS ?? 5);

async function runOnce(label: string): Promise<void> {
  try {
    const r = await importRange({ days: DAYS });
    console.log(`[${label}] ${r.days} dag(en), ${r.channels} zender(s), ${r.programmes} programma's, ${r.errors.length} fout(en)`);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[${label}] ${msg}`);
    await appendLog({ level: 'error', source: 'system', message: `Geplande import mislukt: ${msg}` });
  }
}

async function main(): Promise<void> {
  console.log(`Scheduler gestart: elke ${Math.round(INTERVAL_MS / 60000)} min. Import ${DAYS} dag(en).`);
  await runOnce('startup');
  setInterval(() => runOnce('interval'), INTERVAL_MS);
}

main();
