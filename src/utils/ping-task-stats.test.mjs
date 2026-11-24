import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

test("task statistics avoid argument limits on large histories", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { calculateTaskStats } = await vite.ssrLoadModule("/src/utils/RecordHelper.tsx");
    const start = Date.UTC(2026, 10, 1);
    const count = 150_000;
    const records = Array.from({ length: count }, (_, index) => ({
      task_id: index % 2,
      time: new Date(start + index * 1000).toISOString(),
      value: index > count - 5 ? -1 : 20,
    }));
    const latest = records[count - 5];
    assert.deepEqual(calculateTaskStats(records, 1, null, { intervalSec: 2 }), {
      loss: 0,
      missing: 0,
      latestValue: latest.value,
      latestTime: latest.time,
      actualCount: count / 2,
      failedCount: 2,
      expectedCount: count / 2,
    });
  } finally {
    await vite.close();
  }
});
