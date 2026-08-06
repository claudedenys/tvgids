/**
 * CLI voor de EPG-import.
 *
 * Gebruik:
 *   npx tsx scripts/import.ts                     # vandaag + 5 dagen, alle actieve zenders
 *   npx tsx scripts/import.ts --start 2026-08-01  # start vanaf een datum
 *   npx tsx scripts/import.ts --days 3            # aantal dagen
 *   npx tsx scripts/import.ts --channels npo1,play4
 */
import { importRange } from '../src/lib/import';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const start = arg('start') ?? undefined;
  const days = arg('days') ? Number(arg('days')) : undefined;
  const channelIds = arg('channels')?.split(',').map((s) => s.trim()).filter(Boolean);
  const lenient = process.argv.includes('--lenient');

  console.log(`Start import${start ? ` vanaf ${start}` : ''}, ${days ?? 5} dag(en)`);
  const result = await importRange({ start, days, channelIds });
  console.log('Klaar:', JSON.stringify(result, null, 2));
  if (result.errors.length && !lenient) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
