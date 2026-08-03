/**
 * Automatische EPG-updates binnen de Astro-server (productie).
 * Importeert bij de start en daarna om de INTERVAL_MS.
 */
import { importRange } from './import';
import { appendLog } from './store';

const INTERVAL_MS = Number(process.env.AUTO_UPDATE_INTERVAL ?? 6 * 60 * 60 * 1000); // elke 6 uur
const DAYS = Number(process.env.IMPORT_DAYS ?? 5);

export function startAutoUpdate(): void {
  const run = async (label: string) => {
    try {
      const r = await importRange({ days: DAYS });
      console.log(`[auto-update:${label}] ${r.days} dag(en), ${r.channels} zender(s), ${r.programmes} programma's`);
    } catch (err) {
      console.error(`[auto-update:${label}]`, (err as Error).message);
      await appendLog({ level: 'error', source: 'system', message: `Auto-update mislukt: ${(err as Error).message}` });
    }
  };
  run('start');
  setInterval(() => run('interval'), INTERVAL_MS);
}
