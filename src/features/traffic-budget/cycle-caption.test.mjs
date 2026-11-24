import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('card caption shows days until reset, including the final partial day', async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, esbuild: { jsx: 'automatic' } });
  try {
    const { CycleTrafficBar } = await vite.ssrLoadModule('/src/features/traffic-budget/CycleTrafficBar.tsx');
    const quota = { limit_bytes: 100, used_bytes: 25, period_start: '2026-10-24T16:00:00Z',
      period_end: '2026-11-24T16:00:00Z' };
    for (const [time, days] of [['2026-11-22T16:00:00Z', 2], ['2026-11-24T15:59:59Z', 1]]) {
      const html = renderToStaticMarkup(createElement(CycleTrafficBar, { quota, now: Date.parse(time) }));
      assert.ok(html.includes(`<span>${days} 天后重置</span>`));
    }
  } finally {
    await vite.close();
  }
});
