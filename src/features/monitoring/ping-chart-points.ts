import type { PingHistoryRecord } from "@/types/node";

export type PingChartPoint = { time: number } & { [taskId: number]: number | null };

export function mergePingChartPoints(
  records: readonly PingHistoryRecord[],
  toleranceMs: number,
  hours: number,
): PingChartPoint[] {
  const slots = new Map<number, { point: PingChartPoint; order: number }>();
  const points: PingChartPoint[] = [];
  // Two anchors close enough to share a slot would have been merged already.
  const slotWidth = toleranceMs + 1;
  for (const record of records) {
    const time = Date.parse(record.time);
    if (!Number.isFinite(time)) continue;
    const slot = Math.floor(time / slotWidth);
    let anchor: { point: PingChartPoint; order: number } | undefined;

    for (let adjacent = slot - 1; adjacent <= slot + 1; adjacent++) {
      const candidate = slots.get(adjacent);
      if (
        candidate &&
        Math.abs(candidate.point.time - time) <= toleranceMs &&
        (!anchor || candidate.order < anchor.order)
      ) {
        anchor = candidate;
      }
    }

    if (!anchor) {
      const point = { time };
      anchor = { point, order: points.length };
      slots.set(slot, anchor);
      points.push(point);
    }
    anchor.point[record.task_id] = record.value < 0 ? null : record.value;
  }

  points.sort((left, right) => left.time - right.time);
  const latest = points.at(-1);
  if (!latest) return points;
  const from = latest.time - hours * 3600_000;
  const firstVisible = points.findIndex((point) => point.time >= from);
  return firstVisible > 1 ? points.slice(firstVisible - 1) : points;
}
