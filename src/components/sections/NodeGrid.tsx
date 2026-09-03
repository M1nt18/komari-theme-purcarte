import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatUptime, getOSImage } from "@/utils";
import type { NodeData } from "@/types/node";
import { Link } from "react-router-dom";
import { CpuIcon, MemoryStickIcon, HardDriveIcon, Info } from "lucide-react";
import Flag from "./Flag";
import { Tag } from "../ui/tag";
import { useNodeCommons } from "@/hooks/useNodeCommons";
import { ProgressBar } from "../ui/progress-bar";
import { useAppConfig } from "@/config";
import { useLocale } from "@/config/hooks";
import { NodeDisplayContainer } from "./NodeDisplay";
import { NodeCardPingChart } from "./NodeCardPingChart";

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
    tagList,
    cpuUsage,
    memUsage,
    diskUsage,
    expired_at,
    trafficUsed,
    trafficPercentage,
  } = useNodeCommons(node);
  const { isShowHWBarInCard } = useAppConfig();
  const { t } = useLocale();

  return (
    <Card
      className={`mx-auto flex min-h-[23.75rem] w-full max-w-[21.5rem] flex-col ${
        isOnline
          ? ""
          : "striped-bg-red-translucent-diagonal ring-2 ring-red-500/50"
      }`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-2">
        <Link
          to={`/instance/${node.uuid}`}
          className="hover:underline hover:text-(--accent-11)">
          <div className="flex items-center gap-2">
            <Flag flag={node.region} />
            <img
              src={getOSImage(node.os)}
              alt={node.os}
              className="h-6 w-6 object-contain"
              loading="lazy"
            />
            <CardTitle className="text-base font-bold">{node.name}</CardTitle>
          </div>
        </Link>
        <button onClick={onShowDetails} aria-label="查看节点详情">
          <Info className="h-5 w-5" />
        </button>
      </CardHeader>
      <CardContent className="flex flex-grow flex-col justify-between gap-2 px-4 pb-3 text-sm text-nowrap">
        <div className="flex flex-wrap gap-1">
          <Tag tags={tagList} />
        </div>
        <div className="border-t border-(--accent-4)/50" />
        {isShowHWBarInCard && (
          <div className="flex items-center justify-around whitespace-nowrap">
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

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
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
          <UsageMetric
            label={t("node.disk")}
            value={`${diskUsage.toFixed(0)}%`}
            percentage={diskUsage}
          />
          <UsageMetric
            label="已用流量"
            value={stats ? formatBytes(trafficUsed) : t("node.notAvailable")}
            percentage={trafficPercentage}
            muted={!node.traffic_limit}
          />
        </div>

        <div className="border-t border-(--accent-4)/50" />
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

        <NodeCardPingChart node={node} />

        <div className="flex justify-between text-xs">
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
        h="h-1.5"
        className={muted ? "opacity-0" : undefined}
      />
    </div>
  );
}
