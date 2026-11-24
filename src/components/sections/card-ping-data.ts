import type { PingHistoryRecord, PingTask } from "@/types/node";

interface TimedValue {
  time: number;
  value: number;
}

export function cardPingData(
  records: readonly PingHistoryRecord[],
  tasks: readonly Pick<PingTask, "id">[],
  barCount: number,
  hours: number,
  end: number,
) {
  const latest = new Map<number, TimedValue | null>(tasks.map(task => [task.id, null]));
  const count = Math.max(8, Math.min(60, Math.trunc(barCount)));
  const duration = hours * 3600000;
  const start = end - duration;
  const bars: (number | null)[] = Array(tasks.length ? count : 0).fill(null);
  const samples = new Uint32Array(bars.length);
  function add(time: number, value: number) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((time - start) * count / duration)));
    const sum = bars[index] ?? 0;
    bars[index] = value < 0 || sum < 0 ? -1 : sum + value;
    samples[index]++;
  }
  const buckets = new Map<number, { sum: number; count: number }>();
  let actual = 0, failed = 0;

  for (const record of records) {
    const previous = latest.get(record.task_id);
    if (previous === undefined) continue;
    const time = Date.parse(record.time);
    if (!Number.isFinite(time) || time < start || time > end || !Number.isFinite(record.value)) continue;
    actual++;
    if (record.value < 0) failed++;
    if (record.value >= 0 && (!previous || time > previous.time)) {
      latest.set(record.task_id, { time, value: record.value });
    }
    if (tasks.length === 1) {
      add(time, record.value);
    } else {
      const slot = Math.round(time / 30_000) * 30_000;
      const bucket = buckets.get(slot);
      // Any failed probe marks its entire displayed time bucket as lost.
      if (!bucket) buckets.set(slot, { sum: record.value, count: 1 });
      else {
        bucket.count++;
        if (record.value < 0) bucket.sum = -1;
        else if (bucket.sum >= 0) bucket.sum += record.value;
      }
    }
  }

  for (const [time, { sum, count }] of buckets) {
    add(time, sum < 0 ? -1 : sum / count);
  }
  let latestTotal = 0, respondingTasks = 0;
  for (const point of latest.values()) {
    if (point) {
      latestTotal += point.value;
      respondingTasks++;
    }
  }
  return {
    bars: bars.map((sum, i) => sum === null || sum < 0 ? sum : sum / samples[i]),
    stats: {
      latestValue: respondingTasks ? latestTotal / respondingTasks : null,
      loss: actual ? Math.round((failed / actual) * 100 * 10) / 10 : 0,
    },
  };
}
