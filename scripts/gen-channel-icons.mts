/**
 * Genereert eigen zendericonen (SVG, merk-kleur + monogram) voor alle kanalen
 * in `data/channels.json` en schrijft ze naar `public/icons/channels/{id}.svg`.
 *
 * Aanleiding: de officiële Telenet-logo-URLs zijn deels kapot
 * (9 NL-zenders tonen dezelfde generieke afbeelding; Play Sports Open geen logo).
 * Loopt met `npm run gen-channel-icons`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import channelsJson from '../data/channels.json' with { type: 'json' };

type Channel = { id: string; name: string };

interface IconSpec {
  label: string;
  bg: string;
  fg: string;
}

const SPECS: Record<string, IconSpec> = {
  vrt1: { label: 'V1', bg: '#FFC800', fg: '#000000' },
  vrtcanvas: { label: 'C', bg: '#0066B3', fg: '#FFFFFF' },
  ketnet: { label: 'K', bg: '#22B573', fg: '#FFFFFF' },
  vtm: { label: 'VTM', bg: '#00A651', fg: '#FFFFFF' },
  vtm2: { label: 'V2', bg: '#7B2E9E', fg: '#FFFFFF' },
  vtm3: { label: 'V3', bg: '#F26522', fg: '#FFFFFF' },
  vtm4: { label: 'V4', bg: '#00A9C8', fg: '#FFFFFF' },
  play4: { label: 'P4', bg: '#E60000', fg: '#FFFFFF' },
  play5: { label: 'P5', bg: '#009A57', fg: '#FFFFFF' },
  play6: { label: 'P6', bg: '#E5007D', fg: '#FFFFFF' },
  play7: { label: 'P7', bg: '#0072BC', fg: '#FFFFFF' },
  npo1: { label: '1', bg: '#FFD100', fg: '#000000' },
  npo2: { label: '2', bg: '#005CA9', fg: '#FFFFFF' },
  npo3: { label: '3', bg: '#00A05E', fg: '#FFFFFF' },
  rtl4: { label: 'R4', bg: '#E30613', fg: '#FFFFFF' },
  rtl5: { label: 'R5', bg: '#F26522', fg: '#FFFFFF' },
  rtl7: { label: 'R7', bg: '#7FBA00', fg: '#FFFFFF' },
  rtl8: { label: 'R8', bg: '#003DA5', fg: '#FFFFFF' },
  sbs6: { label: 'S6', bg: '#004B87', fg: '#FFFFFF' },
  net5: { label: 'N5', bg: '#00A3E0', fg: '#FFFFFF' },
  veronica: { label: 'V', bg: '#ED1C24', fg: '#FFFFFF' },
  playsports1: { label: 'PS1', bg: '#0B2E4F', fg: '#FFFFFF' },
  playsports2: { label: 'PS2', bg: '#0B2E4F', fg: '#FFFFFF' },
  playsports3: { label: 'PS3', bg: '#0B2E4F', fg: '#FFFFFF' },
  playsports4: { label: 'PS4', bg: '#0B2E4F', fg: '#FFFFFF' },
  'playsports-premierleague': { label: 'PL', bg: '#0B2E4F', fg: '#FFFFFF' },
  'playsports-golf': { label: 'PG', bg: '#0B2E4F', fg: '#FFFFFF' },
  'playsports-open': { label: 'PO', bg: '#0B2E4F', fg: '#FFFFFF' },
  dazn1: { label: 'D1', bg: '#0B0B0F', fg: '#FFFFFF' },
  dazn2: { label: 'D2', bg: '#0B0B0F', fg: '#FFFFFF' },
  dazn3: { label: 'D3', bg: '#0B0B0F', fg: '#FFFFFF' },
  'dazn-jpl1': { label: 'J1', bg: '#12265E', fg: '#FFFFFF' },
  'dazn-jpl2': { label: 'J2', bg: '#12265E', fg: '#FFFFFF' },
  'dazn-jpl3': { label: 'J3', bg: '#12265E', fg: '#FFFFFF' },
};

function fontSizeFor(label: string): number {
  const n = label.length;
  if (n >= 4) return 14;
  if (n === 3) return 17;
  if (n === 2) return 24;
  return 27;
}

function svg(label: string, bg: string, fg: string, name: string): string {
  const size = fontSizeFor(label);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="' + name + '">',
    '<rect width="64" height="64" rx="15" fill="' + bg + '"/>',
    '<text x="32" y="33" text-anchor="middle" dominant-baseline="central"',
    ' font-family="Arial, Helvetica, sans-serif" font-weight="700"',
    ' font-size="' + size + '" fill="' + fg + '">' + label + '</text>',
    '</svg>',
  ].join('');
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons', 'channels');
mkdirSync(outDir, { recursive: true });

const channels = channelsJson as Channel[];
let written = 0;
const missing: string[] = [];
for (const ch of channels) {
  const spec = SPECS[ch.id];
  if (!spec) {
    missing.push(ch.id);
    continue;
  }
  writeFileSync(join(outDir, ch.id + '.svg'), svg(spec.label, spec.bg, spec.fg, ch.name));
  written++;
}
console.log('Zendericonen gegenereerd: ' + written + ' naar ' + outDir);
if (missing.length) console.warn('Geen spec voor: ' + missing.join(', '));
