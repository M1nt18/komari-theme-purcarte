import type { PingHistoryRecord, PingTask } from "@/types/node";

interface TimedValue {
  time: number;
  value: number;
}

function sampleBars(points: TimedValue[], maxBars: number): number[] {
  points.sort((a, b) => a.time - b.time);
  const limit = Math.max(8, Math.floor(maxBars));
  if (points.length <= limit) return points.map(point => point.value);

  const bars: number[] = [];
  let start = 0;
  for (let bar = 0; bar < limit; bar++) {
    const end = Math.ceil((bar + 1) * points.length / limit);
    let sum = 0;
    for (let index = start; index < end; index++) {
      const value = points[index].value;
      if (value < 0) {
        sum = -1;
        break;
      }
      sum += value;
    }
    bars.push(sum < 0 ? -1 : sum / (end - start));
    start = end;
  }
  return bars;
}

export function cardPingData(
  records: readonly PingHistoryRecord[],
  tasks: readonly Pick<PingTask, "id">[],
  maxBars: number,
) {
  const latest = new Map<number, TimedValue | null>(tasks.map(task => [task.id, null]));
  const points: TimedValue[] = [];
  const buckets = new Map<number, { sum: number; count: number }>();
  let actual = 0, failed = 0;

  for (const record of records) {
    const previous = latest.get(record.task_id);
    if (previous === undefined) continue;
    actual++;
    if (record.value < 0) failed++;
    const time = Date.parse(record.time);
    if (!Number.isFinite(time)) continue;
    if (record.value >= 0 && (!previous || time > previous.time)) {
      latest.set(record.task_id, { time, value: record.value });
    }
    if (tasks.length === 1) {
      points.push({ time, value: record.value });
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
    points.push({ time, value: sum < 0 ? -1 : sum / count });
  }
  let latestTotal = 0, respondingTasks = 0;
  for (const point of latest.values()) {
    if (point) {
      latestTotal += point.value;
      respondingTasks++;
    }
  }
  return {
    bars: sampleBars(points, maxBars),
    stats: {
      latestValue: respondingTasks ? latestTotal / respondingTasks : null,
      loss: actual ? Math.round((failed / actual) * 100 * 10) / 10 : 0,
    },
  };
}
