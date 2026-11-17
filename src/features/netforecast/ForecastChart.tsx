import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import type { NodeForecast } from "./types";
import { chartData, GIB } from "./model";
import { forecastGeometry, type ForecastPoint } from "./svgChart";

function ForecastTooltip({ point }: { point: ForecastPoint }) {
  const total = point.predicted ?? point.actual;
  return <div className="nf-tooltip">
    <strong>{point.date}<span>{point.forecast ? "预测" : point.today ? "今日实时" : "历史记录"}</span></strong>
    {!point.forecast && <>
      <p><i className="nf-in" />日入站 <b>{point.incoming == null ? "—" : point.incoming.toFixed(1) + " GB"}</b></p>
      <p><i className="nf-out" />日出站 <b>{point.outgoing == null ? "—" : point.outgoing.toFixed(1) + " GB"}</b></p>
    </>}
    <p className="nf-tooltip-total">{point.forecast ? "预计累计计费" : "累计计费"}
      <b>{total == null ? "—" : total.toFixed(1) + " GB"}</b></p>
  </div>;
}

const tickLabel = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: "compact" }).format(value);

// Native SVG keeps the default detail panel independent of the chart library.
export default memo(function ForecastChart({ node }: { node: NodeForecast }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [selected, setSelected] = useState<number | null>(null);
  const titleId = useId();
  const points = useMemo(() => chartData(node), [node]);
  const quota = node.has_quota ? node.traffic_limit_bytes / GIB : 0;
  const g = useMemo(() => forecastGeometry(points, quota, width), [points, quota, width]);
  const today = points.findIndex(point => point.today);
  const point = selected == null ? undefined : points[selected];
  const mode = node.traffic_limit_type;
  const incomingCounts = !["up", "upload"].includes(mode)
    && (mode !== "max" || node.cumulative.in_bytes >= node.cumulative.out_bytes)
    && (mode !== "min" || node.cumulative.in_bytes <= node.cumulative.out_bytes);
  const outgoingCounts = !["down", "download"].includes(mode)
    && (mode !== "max" || node.cumulative.out_bytes >= node.cumulative.in_bytes)
    && (mode !== "min" || node.cumulative.out_bytes <= node.cumulative.in_bytes);
  const stride = Math.max(1, Math.ceil(points.length / Math.max(2, (width - 84) / 55)));

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(200, Math.round(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div className="nf-chart" ref={host}>
    <div className="nf-axis-labels"><span>累计计费 / GB</span><span>每日流量 / GB</span></div>
    <div className="nf-svg-wrap" onPointerLeave={() => setSelected(null)}>
      <svg className="nf-svg-chart" width="100%" height={275} viewBox={`0 0 ${width} 275`}
        role="img" aria-labelledby={titleId} tabIndex={0}
        aria-description="左右方向键查看每日数据，Esc 关闭提示"
        onBlur={() => setSelected(null)}
        onKeyDown={event => {
          if (event.key === "Escape") setSelected(null);
          else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const delta = event.key === "ArrowLeft" ? -1 : 1;
            setSelected(index => Math.max(0, Math.min(points.length - 1, (index ?? Math.max(0, today)) + delta)));
          }
        }}>
        <title id={titleId}>{node.node_name} 账单周期每日流量与累计计费预测图</title>
        {today >= 0 && <rect x={g.x(today)} y={g.top} width={g.right - g.x(today)} height={g.bottom - g.top}
          fill="var(--nf-accent)" fillOpacity={0.035} />}
        {g.total.ticks.map(value => <g key={value}>
          <line x1={g.left} x2={g.right} y1={g.totalY(value)} y2={g.totalY(value)} stroke="var(--nf-line)" strokeDasharray="3 5" />
          <text x={g.left - 8} y={g.totalY(value) + 3} textAnchor="end">{tickLabel(value)}</text>
        </g>)}
        {g.daily.ticks.map(value => <text key={value} x={g.right + 7} y={g.dailyY(value) + 3}>{tickLabel(value)}</text>)}
        {points.map((p, index) => {
          const bar = Math.min(17, g.band * 0.65);
          const incoming = p.incoming ?? 0, outgoing = p.outgoing ?? 0;
          return <g key={p.date}>
            {p.incoming != null && <rect x={g.x(index) - bar / 2} y={g.dailyY(incoming)} width={bar}
              height={g.bottom - g.dailyY(incoming)} fill="var(--nf-blue)" fillOpacity={incomingCounts ? 0.7 : 0.22} />}
            {p.outgoing != null && <rect x={g.x(index) - bar / 2} y={g.dailyY(incoming + outgoing)} width={bar}
              height={g.dailyY(incoming) - g.dailyY(incoming + outgoing)} fill="var(--nf-accent)" fillOpacity={outgoingCounts ? 0.5 : 0.18} />}
            {(index % stride === 0 || index === points.length - 1 && points.length % stride > 1) &&
              <text x={g.x(index)} y={g.bottom + 19} textAnchor="middle">{p.label}</text>}
          </g>;
        })}
        {node.has_quota && <g>
          <line x1={g.left} x2={g.right} y1={g.totalY(quota)} y2={g.totalY(quota)} stroke="var(--nf-amber)" strokeDasharray="5 5" />
          <text x={g.right - 4} y={g.totalY(quota) + 12} textAnchor="end" fill="var(--nf-amber)">流量限额</text>
        </g>}
        {today >= 0 && <g>
          <line x1={g.x(today)} x2={g.x(today)} y1={g.top} y2={g.bottom} stroke="var(--nf-line)" strokeDasharray="3 4" />
          <text x={g.x(today) + 5} y={g.top + 12}>今日</text>
        </g>}
        <path d={g.actual} fill="none" stroke="var(--nf-accent)" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={g.predicted} fill="none" stroke="var(--nf-accent)" strokeWidth={2.5} strokeDasharray="5 5" strokeLinejoin="round" />
        {point && <line x1={g.x(selected!)} x2={g.x(selected!)} y1={g.top} y2={g.bottom} stroke="var(--nf-muted)" strokeDasharray="2 4" />}
        {points.map((p, index) => <rect key={p.date} x={g.left + g.band * index} y={g.top}
          width={g.band} height={g.bottom - g.top} fill="transparent" onPointerEnter={() => setSelected(index)}
          onPointerDown={() => setSelected(index)} />)}
      </svg>
      {point && <div className="nf-svg-tooltip" style={{left: Math.max(0, Math.min(width - 208, g.x(selected!) + 8))}}>
        <ForecastTooltip point={point} />
      </div>}
    </div>
    <div className="nf-legend">
      <span><i className="nf-in" />每日入站</span><span><i className="nf-out" />每日出站</span>
      <span><i className="nf-line-key" />累计计费</span><span><i className="nf-dash-key" />趋势预测</span>
    </div>
  </div>;
});
