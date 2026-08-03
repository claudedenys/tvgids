import { json } from './_json';
import { runSearch } from '../../lib/search';

export const prerender = false;

/**
 * Zoek API: /api/search?q=koers[&date=YYYY-MM-DD][&channels=id1,id2]
 * Zonder `date` wordt over alle beschikbare dagen gezocht.
 */
export async function GET({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return json({ error: 'Geef minstens 2 tekens op.' }, { status: 400 });
  }
  const date = url.searchParams.get('date') ?? undefined;
  const channels = url.searchParams.get('channels')?.split(',').map((s) => s.trim()).filter(Boolean);

  try {
    const { tokens, date: usedDate, results } = await runSearch(q, date, channels);
    return json({ q, tokens, date: usedDate, count: results.length, results });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
}
