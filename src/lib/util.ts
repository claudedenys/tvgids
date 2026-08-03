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

export function shortChannelId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'TV';
}
