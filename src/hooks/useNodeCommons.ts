import { useMemo, useState } from "react";
import { useTrafficQuota } from "@/features/traffic-budget/useTrafficQuota";
import { formatPrice } from "@/utils";
import type { NodeData } from "@/types/node";
import type { RpcNodeStatus } from "@/types/rpc";
import { useNodeData } from "@/contexts/NodeDataContext";
import { useLiveData } from "@/contexts/LiveDataContext";
import type { NodeDataContextType } from "@/contexts/NodeDataContext";
import type { LiveDataContextType } from "@/contexts/LiveDataContext";
import { useLocale, useAppConfig } from "@/config/hooks";

type SortKey = "trafficUp" | "trafficDown" | "speedUp" | "speedDown" | null;
type SortOrder = "asc" | "desc";
const expirationDateFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const useNodeListCommons = (searchTerm: string) => {
  const {
    nodes: staticNodes,
    loading,
    getGroups,
  } = useNodeData() as NodeDataContextType;
  const { liveData } = useLiveData() as LiveDataContextType;
  const { t } = useLocale();
  const { isOfflineNodesBehind, defaultSelectedGroup } = useAppConfig();
  const [selectedGroup, setSelectedGroup] = useState(
    defaultSelectedGroup || t("group.all")
  );
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const combinedNodes = useMemo(() => {
    if (!staticNodes) return [];
    return staticNodes.map((node: NodeData) => {
      const stats = liveData ? liveData[node.uuid] : undefined;
      return {
        ...node,
        stats: stats,
      };
    });
  }, [staticNodes, liveData]);

  const groups = useMemo(
    () => [t("group.all"), ...getGroups()],
    [getGroups, t]
  );

  const filteredNodes = useMemo(() => {
    let nodes = combinedNodes
      .filter(
        (node: NodeData & { stats?: any }) =>
          selectedGroup === t("group.all") || node.group === selectedGroup
      )
      .filter((node: NodeData) =>
        node.name.toLowerCase().includes(searchTerm.toLowerCase())
      );

    if (isOfflineNodesBehind || sortKey) {
      nodes.sort((a, b) => {
        if (isOfflineNodesBehind) {
          const aOnline = a.stats?.online || false;
          const bOnline = b.stats?.online || false;
          if (aOnline !== bOnline) {
            return aOnline ? -1 : 1;
          }
        }

        if (sortKey) {
          const sortMap: { [key in SortKey & string]: keyof RpcNodeStatus } = {
            trafficUp: "net_total_up",
            trafficDown: "net_total_down",
            speedUp: "net_out",
            speedDown: "net_in",
          };
          const statsKey = sortMap[sortKey];

          const aValue = Number(a.stats?.[statsKey] || 0);
          const bValue = Number(b.stats?.[statsKey] || 0);

          if (sortOrder === "asc") {
            return aValue - bValue;
          } else {
            return bValue - aValue;
          }
        }

        return 0;
      });
    }

    return nodes;
  }, [
    combinedNodes,
    selectedGroup,
    searchTerm,
    sortKey,
    sortOrder,
    t,
    isOfflineNodesBehind,
  ]);

  const stats = useMemo(() => {
    return {
      onlineCount: filteredNodes.filter((n) => n.stats?.online).length,
      totalCount: filteredNodes.length,
      uniqueRegions: new Set(filteredNodes.map((n) => n.region)).size,
      totalTrafficUp: filteredNodes.reduce(
        (acc, node) => acc + (node.stats?.net_total_up || 0),
        0
      ),
      totalTrafficDown: filteredNodes.reduce(
        (acc, node) => acc + (node.stats?.net_total_down || 0),
        0
      ),
      currentSpeedUp: filteredNodes.reduce(
        (acc, node) => acc + (node.stats?.net_out || 0),
        0
      ),
      currentSpeedDown: filteredNodes.reduce(
        (acc, node) => acc + (node.stats?.net_in || 0),
        0
      ),
    };
  }, [filteredNodes]);

  return {
    loading,
    groups,
    filteredNodes,
    stats,
    selectedGroup,
    setSelectedGroup,
    handleSort,
    sortKey,
    sortOrder,
  };
};

export const useNodeCommons = (node: NodeData & { stats?: any }) => {
  const { stats } = node;
  const { t } = useLocale();
  const quota = useTrafficQuota(node.uuid);
  const isOnline = stats ? stats.online : false;
  const price = formatPrice(node.price, node.currency, node.billing_cycle);

  const cpuUsage = stats && isOnline ? stats.cpu : 0;
  const memUsage =
    stats && isOnline && node.mem_total > 0
      ? (stats.ram / node.mem_total) * 100
      : 0;
  const swapUsage =
    stats && isOnline && node.swap_total > 0
      ? (stats.swap / node.swap_total) * 100
      : 0;
  const diskUsage =
    stats && isOnline && node.disk_total > 0
      ? (stats.disk / node.disk_total) * 100
      : 0;

  const load =
    stats && isOnline
      ? `${stats.load.toFixed(2)} | ${stats.load5.toFixed(
          2
        )} | ${stats.load15.toFixed(2)}`
      : t("node.notAvailable");

  const daysLeft =
    node.expired_at && new Date(node.expired_at).getTime() > 0
      ? Math.ceil(
          (new Date(node.expired_at).getTime() - new Date().getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null;

  let daysLeftTag = null;
  let daysLeftText: string | null = null;
  let daysLeftColor: "red" | "orange" | "green" = "green";
  if (daysLeft !== null) {
    const localizedDaysLeftText = t("node.daysLeft", { daysLeft: daysLeft });
    if (daysLeft < 0) {
      daysLeftTag = `${t("node.expired")}<red>`;
      daysLeftText = t("node.expired");
      daysLeftColor = "red";
    } else if (daysLeft <= 7) {
      daysLeftTag = `${localizedDaysLeftText}<red>`;
      daysLeftText = localizedDaysLeftText;
      daysLeftColor = "red";
    } else if (daysLeft <= 15) {
      daysLeftTag = `${localizedDaysLeftText}<orange>`;
      daysLeftText = localizedDaysLeftText;
      daysLeftColor = "orange";
    } else if (daysLeft < 36500) {
      daysLeftTag = `${localizedDaysLeftText}<green>`;
      daysLeftText = localizedDaysLeftText;
      daysLeftColor = "green";
    } else {
      daysLeftTag = `${t("node.longTerm")}<green>`;
      daysLeftText = t("node.longTerm");
      daysLeftColor = "green";
    }
  }

  const expired_at =
    daysLeft !== null && daysLeft > 36500
      ? t("node.longTerm")
      : node.expired_at && new Date(node.expired_at).getTime() > 0
      ? expirationDateFormat.format(new Date(node.expired_at))
      : t("node.notSet");

  const tagList = [
    ...(price ? [price] : []),
    ...(daysLeftTag ? [daysLeftTag] : []),
    ...(typeof node.tags === "string"
      ? node.tags
          .split(";")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : []),
  ];

  const configuredTrafficLimit = quota?.limit_bytes ?? node.traffic_limit ?? 0;
  const trafficUsed = quota?.used_bytes ?? NaN;
  const trafficPercentage = quota?.usage_percent ?? NaN;

  return {
    stats,
    isOnline,
    tagList,
    daysLeftTag,
    daysLeftText,
    daysLeftColor,
    cpuUsage,
    memUsage,
    swapUsage,
    diskUsage,
    load,
    expired_at,
    trafficUsed,
    trafficPercentage,
    trafficQuota: quota,
    trafficLimitType: quota?.billing_mode ?? node.traffic_limit_type,
    trafficLimit: configuredTrafficLimit,
  };
};
