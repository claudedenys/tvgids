/** Browser-safe constanten (geen node-imports) zodat de frontend ze kan gebruiken. */

/** Tijdzone waarin de gids getoond wordt. */
export const APP_TIMEZONE = 'Europe/Brussels';

/** Aantal dagen dat de importer standaard ophaalt (bronnen leveren meestal 2-5 dagen). */
export const DEFAULT_IMPORT_DAYS = 5;

/** Logos CDN van tvgids.nl voor Nederlandse zenders. */
export const TVGIDS_LOGO_CDN = 'https://tvgidsassets.nl/v386/img/channels/120x120';

/** Telenet image-service voor Belgische zenders. */
export const TELENET_IMAGE_SERVICE = 'https://staticqbr-prod-be.gnp.cloud.telenet.tv/image-service';

export function dateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse 'YYYY-MM-DD' naar UTC-middernacht. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
