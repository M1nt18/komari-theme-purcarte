import assert from 'node:assert/strict';
import test from 'node:test';
import { forecastGeometry, type ForecastPoint } from './svgChart.ts';

const point: ForecastPoint = { date: '2026-11-16', label: '11/16', incoming: 3,
  outgoing: 5, actual: 50, predicted: null, today: false, forecast: false };

test('quota and stacked daily traffic fit separate axes at narrow and wide widths', () => {
  for (const width of [200, 360, 1200]) {
    const g = forecastGeometry([point], 100, width);
    assert.ok(g.total.top >= 100);
    assert.ok(g.daily.top >= 8);
    assert.ok(g.totalY(100) >= g.top);
    assert.ok(g.dailyY(8) >= g.top);
    assert.ok(g.x(0) > g.left && g.x(0) < g.right);
  }
});

test('missing history breaks the actual line while today joins the forecast', () => {
  const points = [point, {...point, actual: null}, {...point, actual: 60, predicted: 60, today: true},
    {...point, actual: null, predicted: 70, forecast: true}];
  const g = forecastGeometry(points, 100, 720);
  assert.equal((g.actual.match(/M/g) ?? []).length, 2);
  assert.equal((g.predicted.match(/M/g) ?? []).length, 1);
  assert.equal((g.predicted.match(/L/g) ?? []).length, 1);
  assert.ok(g.actual.includes(`M${g.x(2).toFixed(2)},${g.totalY(60).toFixed(2)}`));
  assert.ok(g.predicted.trimStart().startsWith(`M${g.x(2).toFixed(2)},${g.totalY(60).toFixed(2)}`));
});

test('empty and all-zero history have finite axes without fake line segments', () => {
  const empty = forecastGeometry([], 0, 360);
  assert.equal(empty.actual, '');
  assert.equal(empty.predicted, '');
  assert.ok(Number.isFinite(empty.totalY(0)));
  const zero = forecastGeometry([{...point, actual: 0, incoming: 0, outgoing: 0}], 0, 360);
  assert.ok(!/NaN|Infinity/.test(zero.actual));
  assert.equal(zero.dailyY(0), zero.bottom);
});
