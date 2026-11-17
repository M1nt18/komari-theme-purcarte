import { CycleTrafficBar } from "@/features/traffic-budget/CycleTrafficBar";
import { trafficStore } from "../../../integrations/traffic-ledger/traffic-store.mjs";
import type { TrafficQuota as LedgerQuota } from "../../../integrations/traffic-ledger/traffic-store.mjs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatUptime, getOSImage } from "@/utils";
import type { NodeData } from "@/types/node";
import { Link } from "react-router-dom";
import {
  CpuIcon,
  MemoryStickIcon,
  HardDriveIcon,
  Info,
  NetworkIcon,
} from "lucide-react";
import Flag from "./Flag";
import { useNodeCommons } from "@/hooks/useNodeCommons";
import { ProgressBar } from "../ui/progress-bar";
import { useAppConfig } from "@/config";
import { useLocale } from "@/config/hooks";
import { NodeDisplayContainer } from "./NodeDisplay";
import { NodeCardPingChart } from "./NodeCardPingChart";
import { quotaTitle } from "../../../integrations/traffic-ledger/traffic-store.mjs";
import { nodeTaskName } from '@/config/node-tasks';


interface NodeGridContainerProps {
  nodes: NodeData[];
}

export const NodeGridContainer = ({ nodes }: NodeGridContainerProps) => {
  return (
    <NodeDisplayContainer nodes={nodes}>
      {(node, onShowDetails) => (
        <NodeGrid
          key={node.uuid}
          node={node}
          onShowDetails={onShowDetails}
        />
      )}
    </NodeDisplayContainer>
  );
};

interface NodeGridProps {
  node: NodeData;
  onShowDetails: () => void;
}

export const NodeGrid = ({ node, onShowDetails }: NodeGridProps) => {
  const {
    stats,
    isOnline,
    cpuUsage,
    memUsage,
    swapUsage,
    diskUsage,
    expired_at,
    daysLeftText,
    daysLeftColor,
    trafficQuota: quota,
  } = useNodeCommons(node);
  const {
    isShowHWBarInCard,
    enableCardExpiryBadge,
    enableCardConnectionMetrics,
    enableSwap,
    cardPingChartNodeTasks,
    cardPingChartTaskName,
  } = useAppConfig();
  const { t } = useLocale();

  return (
    <Card data-cycle-card-preview=""
      className={`node-grid-card mx-auto flex min-h-[30rem] w-full max-w-[24rem] flex-col ${
        isOnline
          ? ""
          : "striped-bg-red-translucent-diagonal ring-2 ring-red-500/50"
      }`}>
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto_25px] items-center gap-2 space-y-0 px-5 pt-4 pb-3">
        <Link
          to={`/instance/${node.uuid}`}
          className="min-w-0 hover:underline hover:text-(--accent-11)">
          <div className="flex min-w-0 items-center gap-2">
            <Flag flag={node.region} />
            <img
              src={getOSImage(node.os)}
              alt={node.os}
              className="h-6 w-6 object-contain"
              loading="lazy"
            />
            <CardTitle className="min-w-0 truncate text-base font-bold">
              {node.name}
            </CardTitle>
          </div>
        </Link>
        {enableCardExpiryBadge && daysLeftText && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
              daysLeftColor === "red"
                ? "bg-red-500/12 text-red-600"
                : daysLeftColor === "orange"
                ? "bg-orange-500/12 text-orange-600"
                : "bg-green-500/12 text-green-700"
            }`}>
            {daysLeftText}
          </span>
        )}
        <button
          onClick={onShowDetails}
          aria-label="查看节点详情"
          className="shrink-0">
          <Info className="h-5 w-5" />
        </button>
      </CardHeader>
      <CardContent className="flex flex-grow flex-col justify-start gap-4 px-5 pb-4 text-sm text-nowrap">
        {isShowHWBarInCard && (
          <div className="flex items-center justify-around max-[360px]:flex-wrap max-[360px]:justify-start gap-x-2 gap-y-1 whitespace-nowrap py-2">
            <div className="flex items-center gap-1">
              <CpuIcon className="size-4 flex-shrink-0 text-blue-600" />
              <span>
                {node.cpu_cores} {t("node.cores")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <MemoryStickIcon className="size-4 flex-shrink-0 text-green-600" />
              <span>{formatBytes(node.mem_total)}</span>
            </div>
            <div className="flex items-center gap-1">
              <HardDriveIcon className="size-4 flex-shrink-0 text-red-600" />
              <span>{formatBytes(node.disk_total)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <UsageMetric
            label={t("node.cpu")}
            value={`${cpuUsage.toFixed(0)}%`}
            percentage={cpuUsage}
          />
          <UsageMetric
            label={t("node.mem")}
            value={`${memUsage.toFixed(0)}%`}
            percentage={memUsage}
          />
          {enableSwap && (
            <UsageMetric
              label={t("node.swap")}
              value={node.swap_total > 0 ? `${swapUsage.toFixed(0)}%` : "OFF"}
              percentage={swapUsage}
              muted={node.swap_total <= 0}
            />
          )}
          <UsageMetric
            label={t("node.disk")}
            value={`${diskUsage.toFixed(0)}%`}
            percentage={diskUsage}
          />
        </div>

        {enableCardConnectionMetrics && (
          <div className="grid grid-cols-2 gap-x-5 text-xs">
            <ConnectionMetric
              label="TCP 连接"
              value={stats && isOnline ? stats.connections : 0}
            />
            <ConnectionMetric
              label="UDP 连接"
              value={stats && isOnline ? stats.connections_udp : 0}
            />
          </div>
        )}
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
          <span>{t("node.network")}</span>
          <div>
            <span>
              {t("node.uploadPrefix")}{" "}
              {stats
                ? formatBytes(stats.net_out, true)
                : t("node.notAvailable")}
            </span>
            <span className="ml-2">
              {t("node.downloadPrefix")}{" "}
              {stats ? formatBytes(stats.net_in, true) : t("node.notAvailable")}
            </span>
          </div>
          </div>

          <div className="flex justify-between text-xs">
          <span>{t("node.traffic")}</span>
          <div>
            <span>
              {t("node.uploadPrefix")} {stats
                ? formatBytes(stats.net_total_up)
                : t("node.notAvailable")}
            </span>
            <span className="ml-2">
              {t("node.downloadPrefix")} {stats
                ? formatBytes(stats.net_total_down)
                : t("node.notAvailable")}
            </span>
          </div>
          </div>
        </div>

        {isOnline && stats && (
          <TrafficQuota quota={quota} title={quotaTitle(quota)} />
        )}

        <div data-cycle-ping-preview="" className="min-h-16"><NodeCardPingChart
          node={node}
          singleCarrier={nodeTaskName(cardPingChartNodeTasks,node.uuid,cardPingChartTaskName)}
        /></div>

        <div className="flex justify-between -mt-8 pt-3 text-xs">
          <div className="flex w-full justify-start">
            <span className="mr-1">{t("node.expiredAt")}</span>
            <span>{expired_at}</span>
          </div>
          <div className="mx-2 border-l border-(--accent-4)/50" />
          <div className="flex w-full justify-end">
            <span>
              {isOnline && stats ? (
                <>
                  <span className="mr-1">{t("node.uptime")}</span>
                  <span>{formatUptime(stats.uptime)}</span>
                </>
              ) : (
                t("node.offline")
              )}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

function ConnectionMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-secondary-foreground">
        <NetworkIcon className="size-4 text-(--accent-11)" />
        {label}
      </span>
      <strong className="font-medium tabular-nums text-green-600">{value}</strong>
    </div>
  );
}

function TrafficQuota({quota,title}:{quota:LedgerQuota|undefined;title:string}) {
  const ready=quota&&Number.isFinite(quota.used_bytes)&&Number.isFinite(quota.limit_bytes);
  return <div className="space-y-2 text-xs" title={title}>
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold text-secondary-foreground">{ready&&quota.limit_bytes<=0?'本期用量 ∞':'本期用量'}</span>
      <strong className="font-medium tabular-nums">{ready
        ? <>{formatBytes(Math.max(0,quota.used_bytes))} / {quota.limit_bytes>0?formatBytes(quota.limit_bytes):'∞'}</>
        : '待同步'}</strong>
    </div>
    <CycleTrafficBar quota={quota??{used_bytes:NaN,limit_bytes:NaN,period_start:'',period_end:''}} now={trafficStore.getServerTime()} />
  </div>;
}

function UsageMetric({
  label,
  value,
  percentage,
  muted = false,
}: {
  label: string;
  value: string;
  percentage: number;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0" title={`${label}: ${value}`}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-secondary-foreground">{label}</span>
        <strong className="truncate text-right font-medium tabular-nums">
          {value}
        </strong>
      </div>
      <ProgressBar
        value={percentage}
        h="h-2"
        className={muted ? "opacity-0" : undefined}
      />
    </div>
  );
}
