import { useState, useEffect, useRef } from "react";
import { useNodeData } from "@/contexts/NodeDataContext";
import type { PingHistoryResponse, NodeData } from "@/types/node";
import { createHistoryCache } from "@/utils/historyCache";

const refreshMs = 120_000;
const historyCache = createHistoryCache<PingHistoryResponse | null>(4, 64, refreshMs);

export const usePingChart = (
  node: NodeData | null, hours: number, enabled = true, refreshNearby = false,
) => {
  const { getPingHistory } = useNodeData();
  const [pingHistory, setPingHistory] = useState<PingHistoryResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestLoad = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !node?.uuid) {
      setPingHistory(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${node.uuid}-${hours}`;

    const cached = historyCache.peek(cacheKey);
    let active = true;
    let pending = false;
    setPingHistory(cached ?? null);
    setLoading(cached === undefined);
    setError(null);

    const fetchHistory = async () => {
      if (!active || pending || document.hidden) return;
      pending = true;
      try {
        const data = await historyCache.load(cacheKey, () => getPingHistory(node.uuid, hours));
        if (active && data) {
          setPingHistory(data);
          setError(null);
        }
      } catch (err: any) {
        if (active) setError(err.message || "Failed to fetch history data");
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };

    latestLoad.current = () => void fetchHistory();
    const resumeInitialLoad = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", resumeInitialLoad);
      void fetchHistory();
    };
    if (cached === undefined) {
      if (document.hidden) document.addEventListener("visibilitychange", resumeInitialLoad);
      else void fetchHistory();
    }
    return () => {
      active = false;
      latestLoad.current = null;
      document.removeEventListener("visibilitychange", resumeInitialLoad);
    };
  }, [node?.uuid, hours, getPingHistory, enabled]);

  useEffect(() => {
    if (!enabled || !refreshNearby) return;
    const refresh = () => latestLoad.current?.();
    refresh();
    // Check often enough to refresh shortly after the shared cache expires,
    // even when a queued request finished after the previous interval began.
    const timer = setInterval(refresh, refreshMs / 2);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, refreshNearby, node?.uuid, hours]);

  return {
    loading,
    error,
    pingHistory,
  };
};
