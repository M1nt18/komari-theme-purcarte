import type { PingHistoryRecord } from "@/types/node";

export function pingSummary(
  records: readonly PingHistoryRecord[],
  taskId: number,
  range: readonly [number, number] | null,
) {
  const values: number[] = [];
  let mean = 0;
  let squaredDeviation = 0;
  for (const record of records) {
    if (record.task_id !== taskId || !Number.isFinite(record.value) || record.value < 0) continue;
    const time = Date.parse(record.time);
    if (!Number.isFinite(time) || (range && (time < range[0] || time > range[1]))) continue;
    values.push(record.value);
    const difference = record.value - mean;
    mean += difference / values.length;
    squaredDeviation += difference * (record.value - mean);
  }
  if (!values.length) return { count: 0, p50: null, p99: null, jitter: null };
  values.sort((left, right) => left - right);
  const percentile = (fraction: number) => {
    const position = fraction * (values.length - 1);
    const lower = Math.floor(position);
    return values[lower] + (values[Math.ceil(position)] - values[lower]) * (position - lower);
  };
  return {
    count: values.length,
    p50: percentile(0.5),
    p99: percentile(0.99),
    jitter: values.length >= 2 ? Math.sqrt(Math.max(0, squaredDeviation / values.length)) : null,
  };
}

export function formatPingMetric(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}
