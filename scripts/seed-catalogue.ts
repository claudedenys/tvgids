/**
 * Centrale zendercatalogus opbouwen en opslaan naar data/channels.json.
 * Haalt gratis logo's op van telenet.tv (Belgische zenders) en tvgids.nl
 * (Nederlandse zenders). Voer dit één keer uit na het opzetten van het project.
 *
 * Gebruik: npx tsx scripts/seed-catalogue.ts
 */
import { loadChannels, saveChannels } from '../src/lib/store';
import { buildInitialChannels } from '../src/lib/channels';
import { fetchTelenetChannels } from '../src/lib/sources/telenet';
import { TVGIDS_SOURCE } from '../src/lib/sources/tvgids';

async function main(): Promise<void> {
  const existing = await loadChannels();
  const channels = existing.length ? existing : buildInitialChannels();

  // Belgische/sport logo's van de openbare Telenet-zenderlijst.
  try {
    const list = await fetchTelenetChannels();
    const byId = new Map(list.map((c) => [c.site_id, c.logo]));
    let n = 0;
    for (const c of channels) {
      const src = c.sources.find((s) => s.source === 'telenet.tv');
      if (src && byId.get(src.site_id)) {
        if (c.logo !== byId.get(src.site_id)) {
          c.logo = byId.get(src.site_id)!;
          n++;
        }
      }
    }
    console.log(`Telenet logo's bijgewerkt: ${n}`);
  } catch (err) {
    console.warn('Telenet logo fetch mislukt:', (err as Error).message);
  }

  // Nederlandse logo's via de gratis tvgidsassets CDN.
  // Het logo-nummer per zender zit in de channel-nav van een tvgids-pagina.
  const tvgidsChannels = channels.filter((c) => c.sources.some((s) => s.source === TVGIDS_SOURCE));
  let m = 0;
  for (const c of tvgidsChannels) {
    try {
      const src = c.sources.find((s) => s.source === TVGIDS_SOURCE)!;
      const url = `https://www.tvgids.nl/gids/${src.site_id}`;
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const { parseChannelLogo } = await import('../src/lib/sources/tvgids');
      const logo = parseChannelLogo(html);
      if (logo && c.logo !== logo) {
        c.logo = logo;
        m++;
      }
    } catch {
      /* zender zonder logo wordt met fallback getoond */
    }
  }
  console.log(`tvgids logo's bijgewerkt: ${m}`);

  await saveChannels(channels);
  console.log(`Catalogus opgeslagen: ${channels.length} zenders → data/channels.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
