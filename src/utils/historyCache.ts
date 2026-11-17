// Share identical history requests and bound both concurrency and retained data.
export function createHistoryCache<T>(
  concurrency = 4,
  capacity = 32,
  ttlMs = 120_000,
  now = Date.now,
) {
  const cached = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Promise<T>>();
  const queue: Array<() => void> = [];
  let active = 0;

  const drain = () => {
    while (active < concurrency && queue.length) queue.shift()!();
  };

  const peek = (key: string): T | undefined => {
    const entry = cached.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now()) {
      cached.delete(key);
      return undefined;
    }
    cached.delete(key);
    cached.set(key, entry);
    return entry.value;
  };

  const load = (key: string, fetcher: () => Promise<T>): Promise<T> => {
    const hit = peek(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const existing = pending.get(key);
    if (existing) return existing;

    const request = new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        Promise.resolve().then(fetcher).then(value => {
          if (value != null) {
            cached.set(key, { value, expires: now() + ttlMs });
            while (cached.size > capacity) cached.delete(cached.keys().next().value!);
          }
          resolve(value);
        }, reject).finally(() => {
          pending.delete(key);
          active--;
          drain();
        });
      });
    });
    pending.set(key, request);
    drain();
    return request;
  };

  return { load, peek };
}
