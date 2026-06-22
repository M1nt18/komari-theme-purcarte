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

const LOSS_COLOR = "#ef4444";
const OK_COLOR = "#00d084";

function pickTask(
  tasks: PingTask[],
  taskName: string,
  fallbackTaskId: number
) {
  const keyword = taskName.trim();
  return (
    (keyword
      ? tasks.find((task) => task.name.includes(keyword))
      : undefined) ??
    tasks.find((task) => task.id === fallbackTaskId) ??
    tasks[0]
  );
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

function getLatencyHeight(value: number): number {
  if (value < 0) return 6;
  return Math.max(7, Math.min(24, 24 - value / 18));
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

  const task = pingHistory?.tasks
    ? pickTask(
        pingHistory.tasks,
        cardPingChartTaskName,
        cardPingChartFallbackTaskId
      )
    : undefined;
  const taskRecords =
    task && pingHistory?.records
      ? pingHistory.records.filter((record) => record.task_id === task.id)
      : [];
  const bars = getRecentBars(taskRecords, cardPingChartMaxBars);
  const stats = task
    ? calculateTaskStats(pingHistory?.records ?? [], task.id, null)
    : { loss: 0, latestValue: null, latestTime: null };

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
            <span>Latency</span>
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
          <MiniBars records={bars} loss />
        </div>
      </div>
    </div>
  );
}

function MiniBars({
  records,
  dense = false,
  loss = false,
}: {
  records: PingHistoryRecord[];
  dense?: boolean;
  loss?: boolean;
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
        const height = loss ? (failed ? 18 : 14) : getLatencyHeight(record.value);
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
