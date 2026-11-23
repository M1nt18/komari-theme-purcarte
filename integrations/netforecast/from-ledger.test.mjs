import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptForecastPayload, forecastExpiresAt } from './from-ledger.mjs';

function input(mode = 'max') {
  return { source: 'persistent-ledger', generated_at: '2026-11-14T04:00:00Z', last_sync: '2026-11-14T04:00:00Z', nodes: [{
    uuid: 'node', name: 'Node', quota: { limit_bytes: 1000, billing_mode: mode, reset_day: 13,
      upload_bytes: 80, download_bytes: 120, used_bytes: mode === 'sum' ? 200 : mode === 'up' ? 80 : 120,
      history_partial: false, sample_at: '2026-11-14T03:59:00Z' },
    history: [
      { date: '2026-11-13', timestamp: Date.parse('2026-11-12T16:00:00Z'), in_bytes: 100, out_bytes: 10, is_today: false, samples: 96 },
      { date: '2026-11-14', timestamp: Date.parse('2026-11-13T16:00:00Z'), in_bytes: 20, out_bytes: 70, is_today: true },
    ],
  }] };
}

test('real cycle usage and reset day match ledger, without NIC fallback', () => {
  for (const mode of ['max', 'sum', 'up']) {
    const value = input(mode), result = adaptForecastPayload(value).nodes[0];
    assert.equal(result.cumulative.billable_bytes, value.nodes[0].quota.used_bytes);
    assert.equal(result.cycle.cycleStart, '2026-11-13');
    assert.equal(result.cycle.cycleEnd, '2026-12-13');
    assert.equal(result.chart_series.find(p => p.is_today).cumulative_billable, value.nodes[0].quota.used_bytes);
    assert.equal(result.chart_series.at(-1).cumulative_billable, result.projected.billable_bytes);
    assert.ok(result.chart_series.filter(p => p.is_forecast).every(p => p.in_bytes === 0 && p.out_bytes === 0));
  }
});

test('manual calibration keeps the card and forecast aligned', () => {
  const value = input(); value.nodes[0].quota.used_bytes = 500;
  const result = adaptForecastPayload(value).nodes[0];
  assert.equal(result.cumulative.billable_bytes, 500);
  assert.equal(result.chart_series.at(-1).cumulative_billable, result.projected.billable_bytes);
  assert.ok(result.projected.billable_bytes >= 500);
});

test('old plugin preview responses pass through; stale production data fails explicitly', () => {
  const preview = { ok: true, preview: true, nodes: [] };
  assert.equal(adaptForecastPayload(preview), preview);
  const value = input(); value.last_sync = '2026-11-14T03:00:00Z';
  assert.throws(() => adaptForecastPayload(value), /暂未同步/);
});

test('complete zero-use days count while partial days never bias daily average',()=>{
  const value=input('sum');value.generated_at=value.last_sync='2026-11-16T04:00:00Z';
  value.nodes[0].quota.reset_day=1;
  value.nodes[0].history=Array.from({length:7},(_,i)=>({date:`2026-11-${String(9+i).padStart(2,'0')}`,
    timestamp:Date.parse('2026-11-08T16:00:00Z')+i*86400000,in_bytes:i===0?700:0,out_bytes:0,samples:96,is_today:false}));
  let node=adaptForecastPayload(value).nodes[0];
  assert.equal(node.sample_days,7);assert.ok(node.daily_avg.billable_bytes<100);
  assert.equal(node.chart_series.filter(p=>p.has_data&&!p.is_today&&!p.is_forecast).length,7);
  value.nodes[0].history.forEach(h=>h.samples=1);
  node=adaptForecastPayload(value).nodes[0];assert.equal(node.sample_days,0);
  assert.equal(node.forecast_available,false);assert.ok(Number.isNaN(node.projected.billable_bytes));
});

test('reset boundary invalidates an otherwise fresh forecast and last cycle day has remaining time',()=>{
  const value=input();value.generated_at=value.last_sync='2026-12-12T15:59:00Z';
  value.nodes[0].history=[{date:'2026-12-11',timestamp:Date.parse('2026-12-10T16:00:00Z'),in_bytes:100,out_bytes:10,samples:96}];
  const forecast=adaptForecastPayload(value);
  assert.equal(forecastExpiresAt(forecast),Date.parse('2026-12-12T16:00:00Z'));
  assert.equal(forecast.nodes[0].cycle.daysRemaining,1);
  assert.ok(forecast.nodes[0].projected.billable_bytes>forecast.nodes[0].cumulative.billable_bytes);
});

test('new cycle uses last week of history without adding prior-cycle usage to the chart', () => {
  const value = input('sum');
  value.generated_at = value.last_sync = '2026-11-13T04:00:00Z';
  const node = value.nodes[0];
  node.quota.coverage_start = '2026-10-01T00:00:00Z';
  node.quota.used_bytes = 0;
  node.quota.upload_bytes = node.quota.download_bytes = 0;
  node.history = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-11-${String(index + 6).padStart(2, '0')}`,
    timestamp: Date.parse('2026-11-05T16:00:00Z') + index * 86400000,
    in_bytes: index === 0 ? 10000 : 100,
    out_bytes: 0,
    samples: index === 0 ? 95 : 96,
  }));
  const forecast = adaptForecastPayload(value).nodes[0];
  assert.equal(forecast.sample_days, 6);
  assert.equal(forecast.collecting_samples, false);
  assert.equal(forecast.daily_avg.billable_bytes, 100);
  assert.equal(forecast.cumulative.billable_bytes, 0);
  assert.ok(forecast.projected.billable_bytes > 0);
  assert.equal(forecast.chart_series[0].date, '2026-11-13');

  node.quota.coverage_start = '2026-11-07T08:00:00Z';
  assert.equal(adaptForecastPayload(value).nodes[0].collecting_samples, true);
});
