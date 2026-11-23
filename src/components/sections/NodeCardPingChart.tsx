import type { NodeData, PingHistoryRecord, PingTask } from "@/types/node";
import { useAppConfig } from "@/config";
import { useLocale } from "@/config/hooks";
import { usePingChart } from "@/hooks/usePingChart";
import { useNearViewport } from "@/hooks/useNearViewport";
import { pingBarStrip } from "./ping-bar-strip";
import { calculateTaskStats } from "@/utils/RecordHelper";
import { ActivityIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { nodeTaskName } from '@/config/node-tasks';

interface NodeCardPingChartProps {
  node: NodeData;
  compact?: boolean;
  singleCarrier?: string;
}

interface PingCardStats {
  latestValue: number | null;
  loss: number;
  missing: number;
}

const LOSS_COLOR = "#ef4444";
const OK_COLOR = "#22c55e";
const LIGHT_GREEN_COLOR = "#b5e864";
const YELLOW_COLOR = "#facc15";
const CARRIER_ORDER = ["电信", "移动", "联通"];

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

function pickNetworkTasks(tasks: PingTask[]): PingTask[] {
  const selected: PingTask[] = [];

  CARRIER_ORDER.forEach((keyword) => {
    const task = tasks.find(
      (item) =>
        item.name.includes(keyword) &&
        !selected.some((selectedTask) => selectedTask.id === item.id)
    );
    if (task) selected.push(task);
  });

  tasks.forEach((task) => {
    if (
      selected.length < 3 &&
      !selected.some((selectedTask) => selectedTask.id === task.id)
    ) {
      selected.push(task);
    }
  });

  return selected.slice(0, 3);
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

function getAverageBars(records: PingHistoryRecord[]): PingHistoryRecord[] {
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

export const NodeCardPingChart = memo(function NodeCardPingChart({
  node,
  compact = false,
  singleCarrier,
}: NodeCardPingChartProps) {
  const {
    enableCardPingChart,
    cardPingChartTaskName,
    cardPingChartNodeTasks,
    cardPingChartFallbackTaskId,
    cardPingChartHours,
    cardPingChartMaxBars,
  } = useAppConfig();
  const { t } = useLocale();
  const selectedTaskName = singleCarrier ?? nodeTaskName(cardPingChartNodeTasks, node.uuid, cardPingChartTaskName);
  const { ref, hasApproached } = useNearViewport(enableCardPingChart);
  const { loading: loadingHistory, pingHistory } = usePingChart(node, cardPingChartHours, enableCardPingChart && hasApproached);
  const loading = !hasApproached || loadingHistory;

  // Live CPU/network updates do not change this history. Build only the active
  // presentation, once per history/configuration change instead of every tick.
  const compactData = useMemo(() => {
    const tasks = compact && enableCardPingChart && pingHistory?.tasks
      ? pickTasks(pingHistory.tasks, selectedTaskName, cardPingChartFallbackTaskId)
      : [];
    return buildDisplayData(compact ? pingHistory?.records ?? [] : [], tasks,
      cardPingChartMaxBars, cardPingChartHours);
  }, [compact, enableCardPingChart, pingHistory, selectedTaskName,
    cardPingChartFallbackTaskId, cardPingChartMaxBars, cardPingChartHours]);

  const selectedData = useMemo(() => {
    if (!enableCardPingChart || compact || !selectedTaskName || !pingHistory) return null;
    const task = pickTasks(pingHistory.tasks ?? [], selectedTaskName, cardPingChartFallbackTaskId)[0];
    return task ? buildDisplayData(pingHistory.records ?? [], [task],
      cardPingChartMaxBars, cardPingChartHours) : null;
  }, [enableCardPingChart, compact, selectedTaskName, pingHistory,
    cardPingChartMaxBars, cardPingChartHours, cardPingChartFallbackTaskId]);

  const networkData = useMemo(() => {
    if (!enableCardPingChart || compact || selectedTaskName || !pingHistory) return [];
    return pickNetworkTasks(pingHistory.tasks ?? []).map(task => ({
      task, ...buildDisplayData(pingHistory.records ?? [], [task],
        cardPingChartMaxBars, cardPingChartHours),
    }));
  }, [enableCardPingChart, compact, selectedTaskName, pingHistory,
    cardPingChartMaxBars, cardPingChartHours]);

  if (!enableCardPingChart) return null;

  if (compact) {
    return (
      <div ref={ref} className="flex min-w-0 flex-1 items-center gap-1">
        <ActivityIcon className="size-4 flex-shrink-0 text-(--accent-11)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate">
              {compactData.stats.latestValue !== null
                ? Math.round(compactData.stats.latestValue) + "ms"
                : loading
                ? "..."
                : t("node.notAvailable")}
            </span>
            <span
              className={
                "text-[10px] " +
                (compactData.stats.loss > 0
                  ? "text-red-500"
                  : "text-secondary-foreground")
              }
              title={"丢包 " + compactData.stats.loss.toFixed(1) + "%"}>
              {compactData.stats.loss.toFixed(1)}%
            </span>
          </div>
          <LatencyBars records={compactData.bars} />
        </div>
      </div>
    );
  }

  if (selectedTaskName) {
    return (
      <div ref={ref} className="grid grid-cols-2 gap-4 border-t border-(--accent-4)/50 py-2 text-xs">
        <div className="min-h-16 rounded-lg px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-secondary-foreground">延迟</span>
            <strong className="font-medium tabular-nums text-(--accent-11)">
              {selectedData && selectedData.stats.latestValue !== null
                ? Math.round(selectedData.stats.latestValue) + " ms"
                : loading
                ? "..."
                : "--"}
            </strong>
          </div>
          <LatencyBars records={selectedData?.bars ?? []} />
        </div>
        <div className="min-h-16 rounded-lg px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-secondary-foreground">丢包</span>
            <strong
              className={`font-medium tabular-nums ${
                selectedData?.stats.loss
                  ? "text-red-500"
                  : "text-secondary-foreground"
              }`}>
              {selectedData ? selectedData.stats.loss.toFixed(1) + "%" : "--"}
            </strong>
          </div>
          <LossBars records={selectedData?.bars ?? []} />
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="border-y border-(--accent-4)/50 py-2 text-xs">
      <div className="mb-1 grid grid-cols-[3.75rem_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 text-[10px] text-secondary-foreground">
        <span className="text-center">线路</span>
        <span className="w-8 text-center">延迟</span>
        <span className="w-9 text-center">丢包</span>
      </div>
      <div className="space-y-1.5">
        {networkData.length > 0 ? (
          networkData.map(({ task, bars, stats }) => (
            <div
              key={task.id}
              className="grid grid-cols-[3.75rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
              <span
                className="truncate text-center font-medium"
                title={task.name}>
                {task.name}
              </span>
              <div className="flex min-w-0 items-center gap-1">
                <strong className="w-8 flex-shrink-0 text-center font-medium tabular-nums text-(--accent-11)">
                  {stats.latestValue !== null
                    ? Math.round(stats.latestValue) + "ms"
                    : loading
                    ? "..."
                    : "--"}
                </strong>
                <LatencyBars records={bars} />
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <strong
                  className={
                    "w-9 flex-shrink-0 text-center font-medium tabular-nums " +
                    (stats.loss > 0
                      ? "text-red-500"
                      : "text-secondary-foreground")
                  }>
                  {stats.loss.toFixed(1)}%
                </strong>
                <LossBars records={bars} />
              </div>
            </div>
          ))
        ) : (
          <div className="py-2 text-center text-secondary-foreground">
            {loading ? "加载中..." : t("node.notAvailable")}
          </div>
        )}
      </div>
    </div>
  );
}, (previous, next) => previous.node.uuid === next.node.uuid
  && previous.compact === next.compact && previous.singleCarrier === next.singleCarrier);

function getLatencyColor(value: number): string {
  if (value < 0) return LOSS_COLOR;
  if (value < 50) return OK_COLOR;
  if (value <= 170) return LIGHT_GREEN_COLOR;
  return YELLOW_COLOR;
}

function PingBars({ records, loss = false }: { records: PingHistoryRecord[]; loss?: boolean }) {
  if (!records.length) {
    return <div className="h-2 min-w-0 flex-1" />;
  }

  const colors = records.map(({ value }) => value < 0 ? LOSS_COLOR
    : loss ? OK_COLOR + "bf" : getLatencyColor(value) + "f2");
  return <div aria-hidden="true" className="h-9 preview-ping-chart-up min-w-0 flex-1"
    style={{ backgroundImage: pingBarStrip(colors, colors.length), backgroundSize: "100% 48%",
      backgroundRepeat: "no-repeat", backgroundPosition: "bottom" }} />;
}

function LatencyBars({ records }: { records: PingHistoryRecord[] }) {
  return <PingBars records={records} />;
}

function LossBars({ records }: { records: PingHistoryRecord[] }) {
  return <PingBars records={records} loss />;
}
