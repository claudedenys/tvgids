/**
 * Genereert PNG-iconen voor de PWA uit public/icons/icon.svg.
 * Gebruik: npx tsx scripts/gen-icons.mts
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = path.join(root, 'public/icons/icon.svg');
const out = path.join(root, 'public/icons');

const sizes = [180, 192, 512];

await mkdir(out, { recursive: true });
for (const size of sizes) {
  await sharp(svg).resize(size, size).png().toFile(path.join(out, `icon-${size}.png`));
  console.log(`icon-${size}.png`);
}
