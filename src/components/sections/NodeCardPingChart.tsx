import type { NodeData, PingHistoryRecord, PingTask } from "@/types/node";
import { useAppConfig } from "@/config";
import { useLocale } from "@/config/hooks";
import { usePingChart } from "@/hooks/usePingChart";
import { ActivityIcon } from "lucide-react";

interface NodeCardPingChartProps {
  node: NodeData;
  compact?: boolean;
}

interface PingCardStats {
  latestValue: number | null;
  loss: number;
}

const LOSS_COLOR = "#ef4444";
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

function getRecentBars(
  records: PingHistoryRecord[],
  maxBars: number
): PingHistoryRecord[] {
  return records
    .slice()
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .slice(-Math.max(8, maxBars));
}

function getAverageBars(
  records: PingHistoryRecord[],
  maxBars: number
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
    })
    .slice(-Math.max(8, maxBars));
}

function buildDisplayData(
  records: PingHistoryRecord[],
  tasks: PingTask[],
  maxBars: number
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
  const successCount = selectedRecords.filter((record) => record.value >= 0)
    .length;
  const loss = selectedRecords.length
    ? (1 - successCount / selectedRecords.length) * 100
    : 0;
  const bars =
    tasks.length > 1
      ? getAverageBars(selectedRecords, maxBars)
      : getRecentBars(selectedRecords, maxBars);

  return { bars, stats: { latestValue, loss } };
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
    cardPingChartMaxBars
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
              }`}>
              {stats.loss.toFixed(1)}%
            </span>
          </div>
          <MiniBars records={bars} dense />
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
          <MiniBars records={bars} />
        </div>
        <div className="rounded-md bg-(--accent-a3) px-2 py-1.5">
          <div className="flex justify-between gap-2">
            <span>丢包</span>
            <strong
              className={stats.loss > 0 ? "text-red-500" : "text-(--accent-11)"}>
              {stats.loss.toFixed(1)}%
            </strong>
          </div>
          <MiniBars records={bars} />
        </div>
      </div>
    </div>
  );
}

function MiniBars({
  records,
  dense = false,
}: {
  records: PingHistoryRecord[];
  dense?: boolean;
}) {
  if (!records.length) {
    return <div className={dense ? "mt-0.5 h-2" : "mt-1 h-6"} />;
  }

  return (
    <div
      className={`flex items-end overflow-hidden ${
        dense ? "mt-0.5 h-2 gap-px" : "mt-1 h-6 gap-0.5"
      }`}>
      {records.map((record, index) => {
        const failed = record.value < 0;
        const height = failed ? 18 : 14;
        return (
          <span
            key={`${record.time}-${index}`}
            className={dense ? "w-0.5 rounded-sm" : "w-1 rounded-sm"}
            style={{
              height: dense ? undefined : `${height}px`,
              minHeight: dense ? undefined : "4px",
              backgroundColor: failed ? LOSS_COLOR : OK_COLOR,
              opacity: failed ? 1 : 0.9,
            }}
          />
        );
      })}
    </div>
  );
}
