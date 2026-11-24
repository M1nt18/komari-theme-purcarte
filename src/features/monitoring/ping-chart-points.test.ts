import assert from "node:assert/strict";
import { test } from "node:test";
import { mergePingChartPoints } from "./ping-chart-points.ts";

const epoch = Date.UTC(2026, 10, 24);

function probe(seconds: number, task_id: number, value: number) {
  return { time: new Date(epoch + seconds * 1000).toISOString(), task_id, value };
}

test("overlapping tolerances use the original first anchor and retain explicit loss", () => {
  const records = [probe(10, 1, 20), probe(0, 1, 30), probe(5, 2, -1),
    probe(11, 1, 21), probe(3, 3, 18), { time: "invalid", task_id: 1, value: 4 }];
  assert.deepEqual(mergePingChartPoints(records, 6000, 1), [
    { time: epoch, 1: 30, 3: 18 },
    { time: epoch + 10000, 1: 21, 2: null },
  ]);
});

test("long history merges adjacent tasks and includes the point before the selected range", () => {
  const count = 75_000;
  const records = Array.from({ length: count * 2 }, (_, index) => {
    const task = index % 2;
    return probe(Math.floor(index / 2) * 60 + task * 2, task, 10 + task);
  }).reverse();
  const points = mergePingChartPoints(records, 6000, 24);
  assert.equal(points.length, 1442);
  const last = epoch + ((count - 1) * 60 + 2) * 1000;
  assert.equal(points[0].time, last - 1441 * 60000);
  assert.deepEqual(points.at(-1), { time: last, 0: 10, 1: 11 });
});
