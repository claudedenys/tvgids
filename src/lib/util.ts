/** Kleine helpers. */

/** Voer `fn` uit voor elk item met een maximaal aantal gelijktijdige verzoeken. */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch met retries bij netwerkfouten en HTTP 5xx, en een timeout per poging.
 * Bij een blijvende fout wordt de laatste fout opnieuw gegooid.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { retries = 2, timeoutMs = 20000, backoffMs = 800 } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok || attempt === retries || res.status < 500) return res;
      await sleep(backoffMs * (attempt + 1));
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
      await sleep(backoffMs * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export function shortChannelId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'TV';
}
