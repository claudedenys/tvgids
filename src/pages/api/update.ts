import { json } from './_json';
import { importRange } from '../../lib/import';

export const prerender = false;

let running: Promise<unknown> | null = null;

function authorized(request: Request): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return true; // dev-modus
  const url = new URL(request.url);
  const q = url.searchParams.get('key') ?? '';
  const h = request.headers.get('x-admin-key') ?? '';
  return q === key || h === key;
}

export async function POST({ request }: { request: Request }): Promise<Response> {
  if (!authorized(request)) return json({ error: 'Niet geautoriseerd' }, { status: 401 });
  if (running) return json({ error: 'Een import draait al', running: true }, { status: 409 });

  const days = request.headers.get('x-days') ? Number(request.headers.get('x-days')) : undefined;

  running = importRange({ days })
    .catch((err) => ({ error: (err as Error).message }))
    .finally(() => {
      running = null;
    });

  // Antwoord meteen; de import draait op de achtergrond en wordt gelogd.
  return json({ started: true, message: 'EPG-import gestart op de achtergrond.' }, { status: 202 });
}
