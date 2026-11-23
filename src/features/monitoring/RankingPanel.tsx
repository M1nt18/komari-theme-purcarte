import React, { useMemo, useState } from "react";
import { useLiveData } from "@/contexts/LiveDataContext";
import { useNodeData } from "@/contexts/NodeDataContext";

const metrics = [
  { id: "cpu", label: "CPU" },
  { id: "memory", label: "内存" },
  { id: "upload", label: "上传速率" },
  { id: "download", label: "下载速率" },
] as const;
type Metric = typeof metrics[number]["id"];

function formatRankValue(value: number, metric: Metric) {
  if (metric === "cpu" || metric === "memory") return `${value.toFixed(1)}%`;
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function RankingPanel({ onOpenNode }: { onOpenNode: (uuid: string) => void }) {
  const { liveData } = useLiveData();
  const { nodes } = useNodeData();
  const [metric, setMetric] = useState<Metric>("cpu");
  const ranking = useMemo(() => nodes.flatMap(node => {
    const stats = liveData?.[node.uuid];
    if (!stats?.online) return [];
    const values = {
      cpu: stats.cpu,
      memory: node.mem_total > 0 ? stats.ram * 100 / node.mem_total : NaN,
      upload: stats.net_out,
      download: stats.net_in,
    };
    const value = values[metric];
    return Number.isFinite(value) && value >= 0 ? [{ uuid: node.uuid, name: node.name, value }] : [];
  }).sort((left, right) => right.value - left.value || left.name.localeCompare(right.name)).slice(0, 5),
  [nodes, liveData, metric]);

  return (
    <React.Fragment>
      <div className="monitoring-rank-metrics" role="group" aria-label="排行指标">
        {metrics.map(({ id, label }) => <button type="button" key={id}
          aria-pressed={metric === id} onClick={() => setMetric(id)}>{label}</button>)}
      </div>
      {ranking.length ? <ol className="monitoring-rank-list">
        {ranking.map(node => <li key={node.uuid}>
          <button type="button" onClick={() => onOpenNode(node.uuid)}>
            <span>{node.name}</span><strong>{formatRankValue(node.value, metric)}</strong>
          </button>
        </li>)}
      </ol> : <p role="status">暂无在线机器的实时数据</p>}
    </React.Fragment>
  );
}
