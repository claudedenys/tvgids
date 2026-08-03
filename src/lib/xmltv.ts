/**
 * XMLTV-parser (primaire EPG-importformaat).
 *
 * Ondersteunt:
 *  - lezen uit bestand, string of Buffer
 *  - gzip (.gz) automatisch detecteren via Node's zlib
 *  - <channel> met display-name en icon
 *  - <programme> met start/stop (tijdzone), title, desc, category, icon, episode-num
 *  - tijdzones correct verwerken (zie parseXmltvTime in normalise.ts)
 *  - unieke sleutel channel_id + start_time + title
 */
import { gunzipSync } from 'node:zlib';
import type { Programme, Channel } from './types';
import { parseXmltvTime, toProgramme } from './normalise';

export interface XmltvChannel {
  id: string;
  displayNames: string[];
  icon: string | null;
}

export interface XmltvProgramme {
  channel: string;
  start: number;
  stop: number;
  title: string;
  description: string | null;
  category: string[];
  icon: string | null;
  season: number | null;
  episode: number | null;
  rating: string | null;
}

const TAG = /<([\w.-]+)([^>]*)>([\s\S]*?)<\/\1>/g;
const SELF = /<([\w.-]+)([^>]*)\/>/g;

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function firstTag(inner: string, name: string): string | null {
  const re = new RegExp(`<${name}([^>]*)>([\\s\\S]*?)</${name}>`);
  const m = inner.match(re);
  if (m) return decode(m[2].trim());
  const self = new RegExp(`<${name}([^>]*)/>`).exec(inner);
  return self ? '' : null;
}

function allTags(inner: string, name: string): string[] {
  const re = new RegExp(`<${name}([^>]*)>([\\s\\S]*?)</${name}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) out.push(decode(m[2].trim()));
  return out;
}

function iconOf(inner: string): string | null {
  const m = new RegExp(`<icon([^>]*)>`).exec(inner) || new RegExp(`<icon([^>]*)/>`).exec(inner);
  if (!m) return null;
  return attrs(m[1]).src || null;
}

/** Detecteer en ontdubbel een .gz-buffer. */
export function gunzipIfNeeded(input: Buffer): Buffer {
  if (input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b) {
    return gunzipSync(input);
  }
  return input;
}

/** Parse XMLTV-tekst/buffer naar kanalen en programma's. */
export function parseXmltv(input: Buffer | string): { channels: XmltvChannel[]; programmes: XmltvProgramme[] } {
  const buf = gunzipIfNeeded(Buffer.isBuffer(input) ? input : Buffer.from(input));
  const xml = buf.toString('utf8');

  const channels: XmltvChannel[] = [];
  const programmes: XmltvProgramme[] = [];

  const tvRe = /<tv[^>]*>([\s\S]*?)<\/tv>/;
  const tvMatch = tvRe.exec(xml);
  const body = tvMatch ? tvMatch[1] : xml;

  const chanBlock = new RegExp(`<channel([^>]*)>([\\s\\S]*?)</channel>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = chanBlock.exec(body))) {
    const id = attrs(m[1]).id;
    if (!id) continue;
    const inner = m[2];
    channels.push({
      id,
      displayNames: allTags(inner, 'display-name'),
      icon: iconOf(inner),
    });
  }

  const progBlock = new RegExp(`<programme([^>]*)>([\\s\\S]*?)</programme>`, 'g');
  let p: RegExpExecArray | null;
  while ((p = progBlock.exec(body))) {
    const a = attrs(p[1]);
    const inner = p[2];
    const start = parseXmltvTime(a.start ?? '');
    const stop = parseXmltvTime(a.stop ?? '');
    const title = firstTag(inner, 'title');
    if (!a.channel || !title || start === null) continue;
    const epNum = firstTag(inner, 'episode-num');
    const se = parseEpisodeNum(epNum);
    programmes.push({
      channel: a.channel,
      start,
      stop: stop !== null && stop > start ? stop : start + 30 * 60 * 1000,
      title,
      description: firstTag(inner, 'desc'),
      category: allTags(inner, 'category'),
      icon: iconOf(inner),
      season: se.season,
      episode: se.episode,
      rating: firstTag(inner, 'rating'),
    });
  }

  return { channels, programmes };
}

/** xmltv_ns episode: "S1 E2" of "1.2.0/1". */
function parseEpisodeNum(ep: string | null): { season: number | null; episode: number | null } {
  if (!ep) return { season: null, episode: null };
  let m = ep.match(/S(\d+)E(\d+)/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = ep.match(/^\s*(\d+)\.(\d+)/);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  return { season: null, episode: null };
}

/**
 * Bouw een mapping van xmltv-id → ons zender-id.
 * Negeert @HD/@SD-suffixen die in veel feeds voorkomen.
 */
export function buildXmltvChannelMap(channels: Channel[]): Map<string, string> {
  const map = new Map<string, string>();
  const bare = (id: string) => id.replace(/@\w+/g, '').trim();
  for (const ch of channels) {
    for (const s of ch.sources) {
      if (s.xmltv_id) map.set(bare(s.xmltv_id), ch.id);
    }
  }
  return map;
}

/**
 * Zet geparsete XMLTV-programma's om naar interne Programme-objecten.
 * Programme's zonder match met een bekend kanaal worden overgeslagen.
 */
export function xmltvToProgrammes(
  parsed: { programmes: XmltvProgramme[] },
  channelMap: Map<string, string>,
  source = 'xmltv' as Programme['source'],
): Programme[] {
  const out: Programme[] = [];
  for (const pr of parsed.programmes) {
    const ourId = channelMap.get(pr.channel.replace(/@\w+/g, '').trim());
    if (!ourId) continue;
    const p = toProgramme(ourId, {
      title: pr.title,
      start: pr.start,
      end: pr.stop,
      source,
      description: pr.description,
      category: pr.category,
      image: pr.icon,
      season: pr.season,
      episode: pr.episode,
    });
    if (p) out.push(p);
  }
  return out;
}
