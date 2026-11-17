import type { chartData } from './model';

export type ForecastPoint = ReturnType<typeof chartData>[number];

function axis(max: number) {
  const raw = Math.max(1, max) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(Math.max(1, max) / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

export function forecastGeometry(points: ForecastPoint[], quota: number, width: number) {
  const left = 46, right = Math.max(left + 1, width - 38), top = 18, bottom = 246;
  const plotWidth = right - left;
  const total = axis(Math.max(quota, ...points.flatMap(p => [p.actual ?? 0, p.predicted ?? 0])));
  const daily = axis(Math.max(0, ...points.map(p => (p.incoming ?? 0) + (p.outgoing ?? 0))));
  const band = plotWidth / Math.max(1, points.length);
  const x = (index: number) => left + band * (index + 0.5);
  const totalY = (value: number) => bottom - value / total.top * (bottom - top);
  const dailyY = (value: number) => bottom - value / daily.top * (bottom - top);
  const path = (key: 'actual' | 'predicted') => {
    let previous = false;
    return points.map((point, index) => {
      const value = point[key];
      if (value == null || !Number.isFinite(value)) { previous = false; return ''; }
      const command = `${previous ? 'L' : 'M'}${x(index).toFixed(2)},${totalY(value).toFixed(2)}`;
      previous = true;
      return command;
    }).join(' ');
  };
  return { left, right, top, bottom, band, x, totalY, dailyY, total, daily,
    actual: path('actual'), predicted: path('predicted') };
}
