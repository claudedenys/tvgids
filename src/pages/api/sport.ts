import { json } from './_json';
import { loadSport } from '../../lib/store';
import { brusselsDateKey } from '../../lib/normalise';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? brusselsDateKey(new Date());
  if (!DATE_RE.test(date)) return json({ error: 'Ongeldige datum' }, { status: 400 });
  return json({ date, now: Date.now(), events: await loadSport(date) });
}
