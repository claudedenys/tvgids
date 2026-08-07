/** Gedeelde types voor de TV-gids (backend store + API + frontend). */

export type Country = 'BE' | 'NL' | 'UK' | 'FR' | 'DE' | 'OTHER';

export type ChannelCategory =
  | 'algemeen'
  | 'sport'
  | 'jeugd'
  | 'film'
  | 'documentaire'
  | 'nieuws'
  | 'muziek'
  | 'kids';

/** Groep waarin de zender in de instellingen verschijnt. */
export type ChannelGroup = 'belgie' | 'nederland' | 'sport' | 'overig';

export type SourceId = 'telenet.tv' | 'tvgids.nl' | 'vrt.be' | 'dazn.com' | 'xmltv';

export interface ChannelSource {
  /** Identificatie van de EPG-bron. */
  source: SourceId;
  /** site_id zoals gebruikt door de bron. */
  site_id: string;
  /** xmltv_id zoals gebruikt in XMLTV-feeds. */
  xmltv_id: string;
  /** Prioriteit voor deduplicatie wanneer meerdere bronnen dezelfde zender leveren (hoger = wint). */
  priority: number;
}

export interface Channel {
  /** Eigen stabiel id (bv. 'play4', 'npo1'). Wordt gebruikt in voorkeuren en URL's. */
  id: string;
  /** Toon-naam. */
  name: string;
  country: Country;
  category: ChannelCategory;
  group: ChannelGroup;
  /** URL naar logo (indien beschikbaar). */
  logo: string | null;
  /** Zender is actief in de centrale configuratie. */
  active: boolean;
  /** Bronconfiguratie voor deze zender. */
  sources: ChannelSource[];
  /** Openbare stream / website van de zender (informatief). */
  website: string | null;
}

/** Beschikbaarheidsstatus per zender (tijdens laatste import berekend). */
export interface ChannelStatus {
  channelId: string;
  epgAvailable: boolean;
  lastUpdate: string | null;
  lastError: string | null;
  programmesCount: number;
  daysAvailable: number;
  descriptionAvailable: boolean;
  /** Laatste beschikbare datum (YYYY-MM-DD). */
  lastDate: string | null;
  /** Vroegste beschikbare datum (YYYY-MM-DD). */
  firstDate: string | null;
}

export interface SourceStatus {
  source: SourceId;
  lastUpdate: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  ok: boolean;
  channels: number;
  programmes: number;
  days: number;
}

export interface Programme {
  /** Stabiele unieke sleutel: channelId + start + titel. */
  id: string;
  channel: string;
  title: string;
  /** Start-tijdstip in milliseconden sinds epoch (UTC). */
  start: number;
  /** Eind-tijdstip in milliseconden sinds epoch (UTC). */
  end: number;
  description: string | null;
  category: string[];
  image: string | null;
  icon: string | null;
  source: SourceId;
  season: number | null;
  episode: number | null;
  actors: string[];
  live: boolean;
  /** Vrij veld voor brongegevens. */
  meta?: Record<string, unknown>;
}

export type SportStatus = 'aankomend' | 'live' | 'afgelopen' | 'onbekend';

export interface SportEvent {
  id: string;
  /** Eigen id van het sportevenement (bv. wedstrijd-id). */
  externalId: string | null;
  title: string;
  home: string | null;
  away: string | null;
  competition: string | null;
  /** Sportsoort, bv. 'Voetbal', 'Wielrennen', 'Tennis'. */
  sport?: string | null;
  start: number;
  end: number;
  status: SportStatus;
  /** Uitzendplatform(s), bv. ['DAZN', 'Play Sports']. */
  platforms: string[];
  /** Tv-kana(a)l(en), bv. ['DAZN 1', 'Play Sports 1']. */
  channels: string[];
  /** Kanaal-ids van alle zenders waar de wedstrijd te zien is (zelfde wedstrijd gebundeld). */
  channelIds?: string[];
  description: string | null;
  source: string;
  meta?: Record<string, unknown>;
}

/** Antwoord van de eigen EPG-API. */
export interface EpgResponse {
  date: string;
  now: number;
  timezone: string;
  channels: ChannelWithStatus[];
  programmes: Programme[];
  sport: SportEvent[];
  /** Per zender een waarschuwing, bv. 'geen gegevens voor deze datum'. */
  warnings: { channelId: string; message: string }[];
  /** Datums waarop (enigszins) EPG beschikbaar is. */
  availableDates: string[];
}

export interface ChannelWithStatus extends Channel {
  status: ChannelStatus;
}

/** Gestandaardiseerd zoekresultaat (programma of sportevenement). */
export interface SearchHit {
  id: string;
  type: 'programme' | 'sport';
  date: string;
  channelId: string;
  channelName: string;
  start: number;
  end: number;
  title: string;
  description: string | null;
  category: string[];
  image: string | null;
  competition?: string | null;
  status?: SportStatus;
  home?: string | null;
  away?: string | null;
  platforms?: string[];
  /** Kanaal-ids (zelfde wedstrijd kan op meerdere zenders staan). */
  channelIds?: string[];
  /** Sportsoort, bv. 'Voetbal', 'Wielrennen', 'Tennis'. */
  sport?: string | null;
}

/** Registratie in het append-only update logboek. */
export interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  source: SourceId | 'system';
  message: string;
  programmes?: number;
  channels?: number;
  channelId?: string;
  durationMs?: number;
}
