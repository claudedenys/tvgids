import { json } from './_json';
import { loadChannels, loadStatus } from '../../lib/store';
import type { ChannelWithStatus } from '../../lib/types';

export const prerender = false;

export async function GET(): Promise<Response> {
  const [channels, status] = await Promise.all([loadChannels(), loadStatus()]);
  const withStatus: ChannelWithStatus[] = channels.map((c) => ({
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
  return json(withStatus);
}
