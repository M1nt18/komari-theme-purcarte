import type { NodeData, PingHistoryRecord, PingTask } from "@/types/node";
import { useAppConfig } from "@/config";
import { useLocale } from "@/config/hooks";
import { usePingChart } from "@/hooks/usePingChart";
import { calculateTaskStats } from "@/utils/RecordHelper";
import { ActivityIcon } from "lucide-react";

interface NodeCardPingChartProps {
  node: NodeData;
  compact?: boolean;
}

interface PingCardStats {
  latestValue: number | null;
  loss: number;
  missing: number;
}

const LOSS_COLOR = "#ef4444";
const WARNING_COLOR = "#f59e0b";
const OK_COLOR = "#00d084";

function pickTasks(
  tasks: PingTask[],
  customTaskName: string,
  fallbackTaskId: number
): PingTask[] {
  const keyword = customTaskName.trim();
  if (!keyword) return tasks;

  let task = tasks.find((item) => item.name.includes(keyword));
  task ??= tasks.find((item) => item.id === fallbackTaskId) ?? tasks[0];
  return task ? [task] : [];
}

function aggregateBucket(records: PingHistoryRecord[]): PingHistoryRecord {
  const values = records
    .map((record) => record.value)
    .filter((value) => value >= 0);
  const hasLoss = records.some((record) => record.value < 0);
  const middle = records[Math.floor(records.length / 2)];

  return {
    task_id: middle?.task_id ?? 0,
    time: middle?.time ?? records[0]?.time,
    value:
      hasLoss || !values.length
        ? -1
        : values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function sampleBars(
  records: PingHistoryRecord[],
  maxBars: number
): PingHistoryRecord[] {
  const sorted = records
    .slice()
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const limit = Math.max(8, maxBars);

  if (sorted.length <= limit) return sorted;

  const buckets = Array.from({ length: limit }, () => [] as PingHistoryRecord[]);
  sorted.forEach((record, index) => {
    const bucketIndex = Math.min(
      limit - 1,
      Math.floor((index * limit) / sorted.length)
    );
    buckets[bucketIndex].push(record);
  });

  return buckets.filter((bucket) => bucket.length > 0).map(aggregateBucket);
}

function getAverageBars(
  records: PingHistoryRecord[]
): PingHistoryRecord[] {
  const buckets = new Map<number, PingHistoryRecord[]>();

  records.forEach((record) => {
    const time = new Date(record.time).getTime();
    const bucket = Math.round(time / 30000) * 30000;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), record]);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([time, bucketRecords]) => {
      const values = bucketRecords
        .map((record) => record.value)
        .filter((value) => value >= 0);
      const hasLoss = bucketRecords.some((record) => record.value < 0);
      return {
        task_id: 0,
        time: new Date(time).toISOString(),
        value:
          hasLoss || !values.length
            ? -1
            : values.reduce((sum, value) => sum + value, 0) / values.length,
      };
    });
}

function buildDisplayData(
  records: PingHistoryRecord[],
  tasks: PingTask[],
  maxBars: number,
  hours: number
): { bars: PingHistoryRecord[]; stats: PingCardStats } {
  const taskIds = new Set(tasks.map((task) => task.id));
  const selectedRecords = records.filter((record) => taskIds.has(record.task_id));

  const latestValues = tasks
    .map((task) =>
      selectedRecords
        .filter((record) => record.task_id === task.id && record.value >= 0)
        .sort(
          (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
        )[0]?.value
    )
    .filter((value): value is number => typeof value === "number");

  const latestValue = latestValues.length
    ? latestValues.reduce((sum, value) => sum + value, 0) / latestValues.length
    : null;
  const taskStats = tasks.map((task) =>
    calculateTaskStats(records, task.id, null, {
      intervalSec: task.interval,
      hours,
    })
  );
  const actualCount = taskStats.reduce((sum, stat) => sum + stat.actualCount, 0);
  const failedCount = taskStats.reduce((sum, stat) => sum + stat.failedCount, 0);
  const expectedCount = taskStats.reduce(
    (sum, stat) => sum + stat.expectedCount,
    0
  );
  const loss = actualCount ? (failedCount / actualCount) * 100 : 0;
  const missing = expectedCount
    ? ((expectedCount - actualCount) / expectedCount) * 100
    : 0;
  const bars =
    tasks.length > 1
      ? sampleBars(getAverageBars(selectedRecords), maxBars)
      : sampleBars(selectedRecords, maxBars);

  return {
    bars,
    stats: {
      latestValue,
      loss: Math.round(loss * 10) / 10,
      missing: Math.round(Math.max(0, missing) * 10) / 10,
    },
  };
}

export function NodeCardPingChart({
  node,
  compact = false,
}: NodeCardPingChartProps) {
  const {
    enableCardPingChart,
    cardPingChartTaskName,
    cardPingChartFallbackTaskId,
    cardPingChartHours,
    cardPingChartMaxBars,
  } = useAppConfig();
  const { t } = useLocale();
  const { loading, pingHistory } = usePingChart(node, cardPingChartHours);

  if (!enableCardPingChart) return null;

  const tasks = pingHistory?.tasks
    ? pickTasks(
        pingHistory.tasks,
        cardPingChartTaskName,
        cardPingChartFallbackTaskId
      )
    : [];
  const { bars, stats } = buildDisplayData(
    pingHistory?.records ?? [],
    tasks,
    cardPingChartMaxBars,
    cardPingChartHours
  );

  if (compact) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <ActivityIcon className="size-4 flex-shrink-0 text-(--accent-11)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate">
              {stats.latestValue !== null
                ? `${Math.round(stats.latestValue)}ms`
                : loading
                ? "..."
                : t("node.notAvailable")}
            </span>
            <span
              className={`text-[10px] ${
                stats.loss > 0 ? "text-red-500" : "text-secondary-foreground"
              }`}
              title={`丢包 ${stats.loss.toFixed(1)}% / 缺测 ${stats.missing.toFixed(
                1
              )}%`}>
              {stats.loss.toFixed(1)}%
            </span>
          </div>
          <LatencyBars records={bars} dense />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-(--accent-a3) px-2 py-1.5">
          <div className="flex justify-between gap-2">
            <span>延迟</span>
            <strong className="text-(--accent-11)">
              {stats.latestValue !== null
                ? `${Math.round(stats.latestValue)} ms`
                : loading
                ? "..."
                : t("node.notAvailable")}
            </strong>
          </div>
          <LatencyBars records={bars} />
        </div>
        <div className="rounded-md bg-(--accent-a3) px-2 py-1.5">
          <div className="flex justify-between gap-2">
            <span>丢包</span>
            <div className="text-right leading-tight">
              <strong
                className={
                  stats.loss > 0 ? "text-red-500" : "text-(--accent-11)"
                }>
                {stats.loss.toFixed(1)}%
              </strong>
              <div
                className={
                  stats.missing > 0
                    ? "text-[10px] text-amber-500"
                    : "text-[10px] text-secondary-foreground"
                }>
                缺测 {stats.missing.toFixed(1)}%
              </div>
            </div>
          </div>
          <LossBars records={bars} />
        </div>
      </div>
    </div>
  );
}

function getLatencyColor(value: number, baseline: number): string {
  if (value < 0) return LOSS_COLOR;
  if (value >= Math.max(800, baseline * 2.5)) return WARNING_COLOR;
  if (value >= Math.max(350, baseline * 1.8)) return WARNING_COLOR;
  return OK_COLOR;
}

function getSuccessfulValues(records: PingHistoryRecord[]): number[] {
  return records
    .map((record) => record.value)
    .filter((value) => value >= 0 && Number.isFinite(value));
}

function getLatencyBaseline(values: number[]): number {
  if (!values.length) return 200;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 200;
}

function LatencyBars({
  records,
  dense = false,
}: {
  records: PingHistoryRecord[];
  dense?: boolean;
}) {
  if (!records.length) {
    return <div className={dense ? "mt-0.5 h-2" : "mt-1 h-6"} />;
  }

  const values = getSuccessfulValues(records);
  const maxValue = Math.max(...values, 1);
  const baseline = getLatencyBaseline(values);
  const maxHeight = dense ? 8 : 22;
  const minHeight = dense ? 2 : 4;

  return (
    <div
      className={`flex items-end overflow-hidden ${
        dense ? "mt-0.5 h-2 gap-px" : "mt-1 h-6 gap-0.5"
      }`}>
      {records.map((record, index) => {
        const failed = record.value < 0;
        const ratio = failed ? 1 : Math.max(0.1, record.value / maxValue);
        const height = Math.round(minHeight + ratio * (maxHeight - minHeight));
        return (
          <span
            key={`${record.time}-${index}`}
            className={dense ? "w-0.5 rounded-sm" : "w-1 rounded-sm"}
            style={{
              height: `${height}px`,
              minHeight: `${minHeight}px`,
              backgroundColor: getLatencyColor(record.value, baseline),
              opacity: failed ? 1 : 0.9,
            }}
          />
        );
      })}
    </div>
  );
}

function LossBars({ records }: { records: PingHistoryRecord[] }) {
  if (!records.length) {
    return <div className="mt-1 h-6" />;
  }

  return (
    <div className="mt-1 flex h-6 items-end gap-0.5 overflow-hidden">
      {records.map((record, index) => {
        const failed = record.value < 0;
        return (
          <span
            key={`${record.time}-${index}`}
            className="w-1 rounded-sm"
            style={{
              height: failed ? "20px" : "5px",
              minHeight: "4px",
              backgroundColor: failed ? LOSS_COLOR : OK_COLOR,
              opacity: failed ? 1 : 0.45,
            }}
          />
        );
      })}
    </div>
  );
}
