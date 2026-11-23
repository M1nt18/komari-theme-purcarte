// Shared by the source theme and the narrowly patched production Home chunk.
// No browser storage or raw NIC fallback: the server owns cycle accounting.
export function createTrafficStore(env = globalThis) {
  let data, receivedAt = 0, revision = 0, timer, pending = false;
  let lastAttempt = -Infinity, available = '';
  const listeners = new Set();
  const clock = () => env.performance.now();
  const serverNow = () => data ? Date.parse(data.server_time) + clock() - receivedAt : NaN;
  const current = (uuid) => {
    const node = data?.nodes?.[uuid];
    const now = serverNow();
    return node && now >= Date.parse(node.period_start) && now < Date.parse(node.period_end)
      && now - Date.parse(data.last_sync) < 120000 ? node : undefined;
  };
  const emit = () => { revision++; for (const callback of listeners) callback(); };
  const availability = () => Object.keys(data?.nodes || {}).filter(id => current(id)).sort().join(',');
  async function refresh() {
    if (pending || env.document?.hidden) return;
    pending = true;
    lastAttempt = clock();
    const controller = new AbortController();
    const timeout = env.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await env.fetch('/api/purcarte/traffic', {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) data = undefined;
      if (!response.ok) throw new Error('Traffic snapshot unavailable');
      const payload = await response.json();
      if (payload.status !== 'success' || !payload.data?.nodes
          || !Number.isFinite(Date.parse(payload.data.server_time))
          || !Number.isFinite(Date.parse(payload.data.last_sync))) throw new Error('Invalid traffic snapshot');
      data = payload.data;
      receivedAt = clock();
    } catch {
      // A brief outage retains a recent snapshot only within the same cycle.
    } finally {
      env.clearTimeout(timeout);
      pending = false;
      available = availability();
      emit();
    }
  }
  const tick = () => {
    if (env.document?.hidden) return;
    const next = availability();
    if (next !== available) {
      available = next;
      emit();
      void refresh();
    } else if (clock() - lastAttempt >= 15000) void refresh();
  };
  const resume = () => { if (!env.document?.hidden) { tick(); void refresh(); } };
  return {
    get: current,
    getServerTime: serverNow,
    getSnapshot: () => revision,
    refresh,
    subscribe(callback) {
      listeners.add(callback);
      if (listeners.size === 1) {
        timer = env.setInterval(tick, 1000);
        env.document?.addEventListener('visibilitychange', resume);
        void refresh();
      }
      return () => {
        listeners.delete(callback);
        if (!listeners.size) {
          env.clearInterval(timer);
          env.document?.removeEventListener('visibilitychange', resume);
        }
      };
    },
  };
}

export const trafficStore = createTrafficStore();

const quotaResetFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
});

export function quotaTitle(node) {
  if (!node) return '流量账本待同步';
  const reset = quotaResetFormat.format(new Date(node.period_end));
  return `本周期已用 / 配额；下次重置：${reset}（北京时间）`
    + (node.history_partial ? '；早期历史不完整，当前按现有采样累计' : '');
}
