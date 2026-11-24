import type { NodeData } from "@/types/node";
import { useAppConfig } from "@/config";
import { useLocale } from "@/config/hooks";
import { usePingChart } from "@/hooks/usePingChart";
import { useNearViewport } from "@/hooks/useNearViewport";
import { pingBarStrip } from "./ping-bar-strip";
import { cardPingData } from "./card-ping-data";
import { ActivityIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { nodeTaskName, selectCardPingTasks } from "@/config/node-tasks";

interface NodeCardPingChartProps {
  node: NodeData;
  compact?: boolean;
}

const LOSS_COLOR = "#ef4444";
const OK_COLOR = "#22c55e";
const LIGHT_GREEN_COLOR = "#b5e864";
const YELLOW_COLOR = "#facc15";
export const NodeCardPingChart = memo(function NodeCardPingChart({
  node,
  compact = false,
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
  const { pathname } = useLocation();
  const selectedTaskName = useMemo(() =>
    nodeTaskName(cardPingChartNodeTasks, node.uuid, cardPingChartTaskName, compact ? "" : "电信"),
    [cardPingChartNodeTasks, node.uuid, cardPingChartTaskName, compact]);
  const { ref, hasApproached, isNear } = useNearViewport(enableCardPingChart);
  const { loading: loadingHistory, pingHistory } = usePingChart(
    node, cardPingChartHours, enableCardPingChart && hasApproached, isNear && pathname === "/"
  );
  const windowEnd = useMemo(() => pingHistory ? Date.now() : 0, [pingHistory]);
  const loading = !hasApproached || loadingHistory;

  const selectedData = useMemo(() => {
    if (!enableCardPingChart || !pingHistory) return null;
    const tasks = selectCardPingTasks(pingHistory.tasks ?? [], selectedTaskName, cardPingChartFallbackTaskId);
    return tasks.length ? cardPingData(
      pingHistory.records ?? [], tasks, cardPingChartMaxBars, cardPingChartHours, windowEnd
    ) : null;
  }, [enableCardPingChart, selectedTaskName, pingHistory,
    cardPingChartMaxBars, cardPingChartFallbackTaskId, cardPingChartHours, windowEnd]);

  if (!enableCardPingChart) return null;

  if (compact) {
    return (
      <div ref={ref} className="flex min-w-0 flex-1 items-center gap-1">
        <ActivityIcon className="size-4 flex-shrink-0 text-(--accent-11)" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate">
              {selectedData && selectedData.stats.latestValue !== null
                ? Math.round(selectedData.stats.latestValue) + "ms"
                : loading
                ? "..."
                : t("node.notAvailable")}
            </span>
            <span
              className={
                "text-[10px] " +
                (selectedData?.stats.loss
                  ? "text-red-500"
                  : "text-secondary-foreground")
              }
              title={t("chart.packetLoss")}>
              {selectedData ? selectedData.stats.loss.toFixed(1) + "%" : "--"}
            </span>
          </div>
          <LatencyBars values={selectedData?.bars ?? []} />
        </div>
      </div>
    );
  }

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
}, (previous, next) => previous.node.uuid === next.node.uuid
  && previous.compact === next.compact);

function getLatencyColor(value: number): string {
  if (value < 0) return LOSS_COLOR;
  if (value < 50) return OK_COLOR;
  if (value <= 170) return LIGHT_GREEN_COLOR;
  return YELLOW_COLOR;
}

function PingBars({ values, loss = false }: { values: (number | null)[]; loss?: boolean }) {
  if (!values.length) {
    return <div className="h-2 min-w-0 flex-1" />;
  }

  const colors = values.map(value => value === null ? "#94a3b866" : value < 0 ? LOSS_COLOR
    : loss ? OK_COLOR + "bf" : getLatencyColor(value) + "f2");
  return <div aria-hidden="true" title={values.includes(null) ? "灰色表示该时段没有采样" : undefined} className="h-9 preview-ping-chart-up min-w-0 flex-1"
    style={{ backgroundImage: pingBarStrip(colors, colors.length), backgroundSize: "100% 48%",
      backgroundRepeat: "no-repeat", backgroundPosition: "bottom" }} />;
}

function LatencyBars({ values }: { values: (number | null)[] }) {
  return <PingBars values={values} />;
}

function LossBars({ values }: { values: (number | null)[] }) {
  return <PingBars values={values} loss />;
}
