import { json } from './_json';
import { loadChannels, loadStatus, loadProgrammes, loadSport, allAvailableDates } from '../../lib/store';
import { brusselsDayStart, brusselsDayEnd, brusselsDateKey } from '../../lib/normalise';
import { APP_TIMEZONE } from '../../lib/config';
import type { ChannelWithStatus, EpgResponse } from '../../lib/types';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get('date') ?? brusselsDateKey(new Date());
  if (!DATE_RE.test(dateParam)) {
    return json({ error: `Ongeldige datum: ${dateParam}. Gebruik YYYY-MM-DD.` }, { status: 400 });
  }
  const wanted = url.searchParams
    .get('channels')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? null;

  const [channels, status] = await Promise.all([loadChannels(), loadStatus()]);
  let selected = channels.filter((c) => c.active);
  if (wanted) selected = wanted.map((id) => selected.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));

  const dayStart = brusselsDayStart(dateParam);
  const dayEnd = brusselsDayEnd(dateParam);

  const programmes = [];
  const warnings: EpgResponse['warnings'] = [];
  for (const c of selected) {
    const progs = await loadProgrammes(c.id, dateParam);
    if (progs.length === 0) {
      const cs = status.channels[c.id];
      warnings.push({
        channelId: c.id,
        message: cs?.epgAvailable
          ? 'EPG beschikbaar, maar geen gegevens voor deze datum.'
          : 'Geen gratis EPG-bron beschikbaar.',
      });
    }
    programmes.push(...progs);
  }

  const sport = await loadSport(dateParam);
  const availableDates = await allAvailableDates();

  const withStatus: ChannelWithStatus[] = selected.map((c) => ({
    ...c,
    status: status.channels[c.id] ?? {
      channelId: c.id,
      epgAvailable: false,
      lastUpdate: null,
      lastError: null,
      programmesCount: 0,
      daysAvailable: 0,
      descriptionAvailable: false,
      lastDate: null,
      firstDate: null,
    },
  }));

  programmes.sort((a, b) => a.start - b.start);

  const response: EpgResponse = {
    date: dateParam,
    now: Date.now(),
    timezone: APP_TIMEZONE,
    channels: withStatus,
    programmes,
    sport,
    warnings,
    availableDates,
  };
  return json(response);
}
