import { useState, useEffect } from "react";
import { useNodeData } from "@/contexts/NodeDataContext";
import type { PingHistoryResponse, NodeData } from "@/types/node";
import { createHistoryCache } from "@/utils/historyCache";

const historyCache = createHistoryCache<PingHistoryResponse | null>();

export const usePingChart = (node: NodeData | null, hours: number, enabled = true) => {
  const { getPingHistory } = useNodeData();
  const [pingHistory, setPingHistory] = useState<PingHistoryResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !node?.uuid) {
      setPingHistory(null);
      setLoading(false);
      return;
    }

    const cacheKey = `${node.uuid}-${hours}`;

    const cached = historyCache.peek(cacheKey);
    if (cached !== undefined) {
      setPingHistory(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setPingHistory(null);
    setLoading(true);
    setError(null);

    const fetchHistory = async () => {
      try {
        const data = await historyCache.load(cacheKey, () => getPingHistory(node.uuid, hours));
        if (active) setPingHistory(data);
      } catch (err: any) {
        if (active) setError(err.message || "Failed to fetch history data");
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchHistory();
    return () => { active = false; };
  }, [node?.uuid, hours, getPingHistory, enabled]);

  return {
    loading,
    error,
    pingHistory,
  };
};
