import assert from "node:assert/strict";
import { test } from "node:test";
import { cardPingData } from "./card-ping-data.ts";

function probe(task_id: number, seconds: number, value: number) {
  return { task_id, time: new Date(seconds * 1000).toISOString(), value };
}

test("card bars preserve chronological order, bucket boundaries and loss", () => {
  const records = Array.from({ length: 17 }, (_, i) => probe(2, i, i === 6 ? -1 : i));
  records.reverse();
  const data = cardPingData([...records, probe(1, 20, -1)], [{ id: 2 }], 8, 17/3600, 17000);
  assert.deepEqual(data.bars, [1, 3.5, -1, 7.5, 9.5, 11.5, 13.5, 15.5]);
  assert.deepEqual(data.stats, { latestValue: 16, loss: 5.9 });
  assert.equal(records[0].value, 16);
});

test("multiple tasks use 30-second averages and their latest successful probe", () => {
  const records = [
    probe(2, 46, 15), probe(1, 15, 9), probe(1, 15, 99),
    probe(1, 14, 4), probe(2, 0, 8), probe(2, 17, -1),
  ];
  const data = cardPingData(records, [{ id: 1 }, { id: 2 }], 20, 600/3600, 600000);
  assert.deepEqual(data.bars, [6, -1, 15, ...Array(17).fill(null)]);
  assert.deepEqual(data.stats, { latestValue: 12, loss: 16.7 });
  assert.equal(cardPingData([probe(1, 0, -1)], [{ id: 1 }], 20, 1, 600000).stats.latestValue, null);
  assert.deepEqual(cardPingData([], [], 20, 1, 600000), { bars: [], stats: { latestValue: null, loss: 0 } });
});

test("changing the count redraws sparse history without inventing probes", () => {
  for (const count of [8, 30, 60]) {
    const data = cardPingData([probe(1, 10, 0), probe(1, 3599, -1)], [{ id: 1 }], count, 1, 3600000);
    assert.equal(data.bars.length, count);
    assert.deepEqual(data.bars.filter(value => value !== null), [0, -1]);
    assert.equal(data.stats.loss, 50);
  }
});
