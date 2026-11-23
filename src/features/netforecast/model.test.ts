import assert from "node:assert/strict";
import test from "node:test";
import { chartData, forecastState, GIB, sampleDays } from "./model.ts";
import type { NodeForecast, TrafficPoint } from "./types.ts";

const day: TrafficPoint = {
  date: "2026-11-14",
  timestamp: 1794614400000,
  in_bytes: 3 * GIB,
  out_bytes: 5 * GIB,
  total_bytes: 8 * GIB,
  cumulative_billable: 50 * GIB,
  has_data: true,
};
const node: NodeForecast = {
  node_id: "test-node",
  node_name: "Test",
  has_quota: true,
  traffic_limit_bytes: 100 * GIB,
  traffic_limit_type: "max",
  traffic_reset_day: 1,
  cycle: {
    cycleStart: "2026-11-01",
    cycleEnd: "2026-12-01",
    daysTotal: 30,
    daysElapsed: 14,
    daysRemaining: 16,
  },
  cumulative: {
    in_bytes: 30 * GIB,
    out_bytes: 50 * GIB,
    billable_bytes: 50 * GIB,
  },
  daily_avg: { in_bytes: 3 * GIB, out_bytes: 5 * GIB, billable_bytes: 5 * GIB },
  projected: {
    in_bytes: 78 * GIB,
    out_bytes: 130 * GIB,
    billable_bytes: 130 * GIB,
  },
  usage_ratio: 1.3,
  status: "CRITICAL",
  chart_series: Array.from({ length: 7 }, (_, index) => ({
    ...day,
    date: `2026-11-${index + 1}`,
  })),
};

test("failed history is not presented as a safe or valid forecast", () => {
  assert.equal(
    forecastState({ ...node, status: "SAFE", fetch_failed: true }),
    "error",
  );
  assert.equal(
    forecastState({ ...node, has_quota: false, fetch_failed: true }),
    "error",
  );
  assert.equal(forecastState({ ...node, has_quota: false }), "unlimited");
});

test("insufficient history is identified while an already exhausted quota stays critical", () => {
  const sparse = { ...node, chart_series: [day, { ...day, is_today: true }] };
  assert.equal(sampleDays(sparse), 1);
  assert.equal(forecastState(sparse), "collecting");
  assert.equal(forecastState({ ...sparse, collecting_samples: false, forecast_available: true }), "critical");
  assert.equal(forecastState({ ...sparse, collecting_samples: false, forecast_available: false }), "error");
  assert.equal(
    forecastState({
      ...sparse,
      cumulative: { ...node.cumulative, billable_bytes: 101 * GIB },
    }),
    "critical",
  );
  assert.equal(forecastState(node), "critical");
});

test("forecast does not create daily traffic bars, and today joins the two billing curves", () => {
  const points = chartData({
    ...node,
    chart_series: [
      { ...day, has_data: false, cumulative_billable: null },
      { ...day, is_today: true },
      {
        ...day,
        is_forecast: true,
        has_data: false,
        cumulative_billable: 55 * GIB,
      },
    ],
  });
  assert.equal(points[0].actual, null);
  assert.equal(points[0].incoming, null);
  assert.equal(points[1].actual, 50);
  assert.equal(points[1].predicted, 50);
  assert.equal(points[1].incoming, 3);
  assert.equal(points[2].incoming, null);
  assert.equal(points[2].outgoing, null);
  assert.equal(points[2].actual, null);
  assert.equal(points[2].predicted, 55);
});
