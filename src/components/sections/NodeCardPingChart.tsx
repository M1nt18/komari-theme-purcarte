import type { NodeData, PingTask } from "@/types/node";
import { useAppConfig } from "@/config";
import { useLocale } from "@/config/hooks";
import { usePingChart } from "@/hooks/usePingChart";
import { useNearViewport } from "@/hooks/useNearViewport";
import { pingBarStrip } from "./ping-bar-strip";
import { cardPingData } from "./card-ping-data";
import { ActivityIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { nodeTaskName } from '@/config/node-tasks';

interface NodeCardPingChartProps {
  node: NodeData;
  compact?: boolean;
  singleCarrier?: string;
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
    return cardPingData(compact ? pingHistory?.records ?? [] : [], tasks,
      cardPingChartMaxBars);
  }, [compact, enableCardPingChart, pingHistory, selectedTaskName,
    cardPingChartFallbackTaskId, cardPingChartMaxBars]);

  const selectedData = useMemo(() => {
    if (!enableCardPingChart || compact || !selectedTaskName || !pingHistory) return null;
    const task = pickTasks(pingHistory.tasks ?? [], selectedTaskName, cardPingChartFallbackTaskId)[0];
    return task ? cardPingData(pingHistory.records ?? [], [task],
      cardPingChartMaxBars) : null;
  }, [enableCardPingChart, compact, selectedTaskName, pingHistory,
    cardPingChartMaxBars, cardPingChartFallbackTaskId]);

  const networkData = useMemo(() => {
    if (!enableCardPingChart || compact || selectedTaskName || !pingHistory) return [];
    return pickNetworkTasks(pingHistory.tasks ?? []).map(task => ({
      task, ...cardPingData(pingHistory.records ?? [], [task],
        cardPingChartMaxBars),
    }));
  }, [enableCardPingChart, compact, selectedTaskName, pingHistory,
    cardPingChartMaxBars]);

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
              title={t("chart.packetLoss") + " " + compactData.stats.loss.toFixed(1) + "%"}>
              {compactData.stats.loss.toFixed(1)}%
            </span>
          </div>
          <LatencyBars values={compactData.bars} />
        </div>
      </div>
    );
  }

  if (selectedTaskName) {
    return (
      <div ref={ref} className="grid grid-cols-2 gap-4 border-t border-(--accent-4)/50 py-2 text-xs">
        <div className="min-h-16 rounded-lg px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-secondary-foreground">{t("instancePage.latency")}</span>
            <strong className="font-medium tabular-nums text-(--accent-11)">
              {selectedData && selectedData.stats.latestValue !== null
                ? Math.round(selectedData.stats.latestValue) + " ms"
                : loading
                ? "..."
                : "--"}
            </strong>
          </div>
          <LatencyBars values={selectedData?.bars ?? []} />
        </div>
        <div className="min-h-16 rounded-lg px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-secondary-foreground">{t("chart.packetLoss")}</span>
            <strong
              className={`font-medium tabular-nums ${
                selectedData?.stats.loss
                  ? "text-red-500"
                  : "text-secondary-foreground"
              }`}>
              {selectedData ? selectedData.stats.loss.toFixed(1) + "%" : "--"}
            </strong>
          </div>
          <LossBars values={selectedData?.bars ?? []} />
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="border-y border-(--accent-4)/50 py-2 text-xs">
      <div className="mb-1 grid grid-cols-[3.75rem_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 text-[10px] text-secondary-foreground">
        <span className="text-center">{t("chart.route")}</span>
        <span className="w-8 text-center">{t("instancePage.latency")}</span>
        <span className="w-9 text-center">{t("chart.packetLoss")}</span>
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
                <LatencyBars values={bars} />
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
                <LossBars values={bars} />
              </div>
            </div>
          ))
        ) : (
          <div className="py-2 text-center text-secondary-foreground">
            {loading ? t("chart.loadingShort") : t("node.notAvailable")}
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

function PingBars({ values, loss = false }: { values: number[]; loss?: boolean }) {
  if (!values.length) {
    return <div className="h-2 min-w-0 flex-1" />;
  }

  const colors = values.map(value => value < 0 ? LOSS_COLOR
    : loss ? OK_COLOR + "bf" : getLatencyColor(value) + "f2");
  return <div aria-hidden="true" className="h-9 preview-ping-chart-up min-w-0 flex-1"
    style={{ backgroundImage: pingBarStrip(colors, colors.length), backgroundSize: "100% 48%",
      backgroundRepeat: "no-repeat", backgroundPosition: "bottom" }} />;
}

function LatencyBars({ values }: { values: number[] }) {
  return <PingBars values={values} />;
}

function LossBars({ values }: { values: number[] }) {
  return <PingBars values={values} loss />;
}
