import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CircleHelp,
  ExternalLink,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { NodeForecast } from "./types";
import {
  forecastState,
  MODE_LABELS,
  projectedPercent,
  sampleDays,
  STATE_LABELS,
  traffic,
} from "./model";
import { useForecast } from "./useForecast";
import ForecastChart from "./ForecastChart";
import "./netforecast.css";

function StateBadge({ node }: { node: NodeForecast }) {
  const state = forecastState(node);
  return (
    <span className={`nf-badge is-${state}`}>
      <i />
      {state === "critical" &&
      node.cumulative.billable_bytes >= node.traffic_limit_bytes
        ? "已超限额"
        : STATE_LABELS[state]}
    </span>
  );
}

function BudgetSummary({ node }: { node: NodeForecast }) {
  const current = node.has_quota
    ? (node.cumulative.billable_bytes / node.traffic_limit_bytes) * 100
    : 0;
  const projected = projectedPercent(node);
  const state = forecastState(node);
  const remaining = Math.max(
    0,
    node.traffic_limit_bytes - node.cumulative.billable_bytes,
  );
  const exhaustion = node.days_until_exhaustion;
  return (
    <aside className="nf-budget">
      <div className="nf-budget-heading">
        <span>周期末预计用量</span>
        <StateBadge node={node} />
      </div>
      <div className="nf-projected">
        {node.fetch_failed ? "—" : traffic(node.projected.billable_bytes)}
      </div>
      <p className="nf-budget-limit">
        {node.has_quota
          ? `流量限额 ${traffic(node.traffic_limit_bytes)}`
          : "该节点未设置流量限额"}
      </p>
      {node.has_quota && (
        <>
          <div
            className="nf-budget-bar"
            aria-label={`当前已用 ${Math.round(current)}%，预计周期末 ${projected ?? 0}%`}
          >
            <span
              className="nf-bar-predicted"
              style={{ width: `${Math.min(100, projected ?? 0)}%` }}
            />
            <span
              className="nf-bar-current"
              style={{ width: `${Math.min(100, current)}%` }}
            />
          </div>
          <div className="nf-bar-labels">
            <span>当前 {Math.round(current)}%</span>
            <b className={`is-${state}`}>
              预计 {projected === null ? "—" : `${projected}%`}
            </b>
          </div>
        </>
      )}
      <dl className="nf-budget-facts">
        <div>
          <dt>本周期计费已用</dt>
          <dd>{traffic(node.cumulative.billable_bytes)}</dd>
        </div>
        <div>
          <dt>剩余可用额度</dt>
          <dd>{node.has_quota ? traffic(remaining) : "未设限额"}</dd>
        </div>
        <div>
          <dt>加权日均用量</dt>
          <dd>
            {node.fetch_failed ? "—" : traffic(node.daily_avg.billable_bytes)}
          </dd>
        </div>
        <div>
          <dt>下次重置</dt>
          <dd>
            {node.cycle.cycleEnd.slice(5).replace("-", "/")}
            <small> · {node.cycle.daysRemaining} 天后</small>
          </dd>
        </div>
      </dl>
      <div className={`nf-insight is-${state}`}>
        {state === "critical" ? (
          <>
            <AlertTriangle size={16} />
            <p>
              {exhaustion === 0
                ? "当前计费用量已超过周期限额。"
                : `按当前趋势，约 ${exhaustion ?? "—"} 天后耗尽额度。`}
              <span>
                周期末预计超出{" "}
                {traffic(
                  Math.max(
                    0,
                    node.projected.billable_bytes - node.traffic_limit_bytes,
                  ),
                )}
              </span>
            </p>
          </>
        ) : state === "warning" ? (
          <>
            <AlertTriangle size={16} />
            <p>
              预计接近周期限额<span>关注近期用量增长，预留额外余量</span>
            </p>
          </>
        ) : state === "collecting" ? (
          <>
            <CircleHelp size={16} />
            <p>
              历史样本正在积累
              <span>已有 {sampleDays(node)} / 7 天，预测仅供参考</span>
            </p>
          </>
        ) : state === "error" ? (
          <>
            <Info size={16} />
            <p>
              历史流量读取失败<span>恢复采集后可重新计算预测</span>
            </p>
          </>
        ) : state === "unlimited" ? (
          <>
            <Info size={16} />
            <p>
              仅展示流量趋势<span>未设置配额，不计算超限风险</span>
            </p>
          </>
        ) : (
          <>
            <ShieldCheck size={16} />
            <p>
              当前趋势处于预算内<span>按该节点的计费规则估算</span>
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

export default function TrafficForecastPanel({
  uuid,
  onOpenNode,
  onClose,
}: {
  uuid?: string;
  onOpenNode?: (uuid: string) => void;
  onClose?: () => void;
}) {
  const { data, loading, error, refresh } = useForecast(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const nodes = data?.nodes ?? [];
  const keyword = query.trim().toLowerCase();
  const visible = nodes.filter(
    (node) =>
      (!uuid || node.node_id === uuid) &&
      (filter === "all" ||
        (filter === "risk"
          ? ["critical", "warning"].includes(forecastState(node))
          : forecastState(node) === filter)) &&
      `${node.node_name} ${node.group ?? ""}`.toLowerCase().includes(keyword),
  );
  const selected =
    visible.find((node) => node.node_id === (uuid || selectedId)) ?? visible[0];
  const states = nodes.map(forecastState);
  const critical = states.filter((state) => state === "critical").length;
  const warning = states.filter((state) => state === "warning").length;
  const healthy = states.filter((state) => state === "safe").length;
  const date = data?.generated_at ? new Date(data.generated_at) : null;
  const updated =
    date && Number.isFinite(date.getTime())
      ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <Card
      id={uuid ? "traffic-detail" : "traffic-overview"}
      className="nf-panel"
      aria-label="网络流量预测"
    >
      <header className="nf-heading">
        <span className="nf-heading-icon">
          <TrendingUp size={24} />
        </span>
        <div className="nf-heading-copy">
          <div>
            <h2>{onClose ? "流量预测总览" : "流量预测"}</h2>
            <span className="nf-product">NetForecast</span>
            {data?.preview && <span className="nf-demo">演示数据</span>}
          </div>
          <p>看清周期用量，提前掌握流量余量</p>
        </div>
        <button
          type="button"
          className="nf-action"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "nf-spin" : ""} />
          刷新
        </button>
        {onClose && (
          <button
            type="button"
            className="nf-action nf-close"
            onClick={onClose}
            aria-label="关闭流量预测窗口"
          >
            <X size={17} />
          </button>
        )}
      </header>

      <>
        {data?.preview && (
          <div className="nf-demo-banner">
            <Info size={15} />
            本地预览 · 以下用量、限额与预测均为演示数据
          </div>
        )}
        {error && (
          <div className="nf-error" role="alert">
            {error}
          </div>
        )}
        {loading && !data ? (
          <div className="nf-empty" role="status">
            <RefreshCw className="nf-spin" size={24} />
            <p>正在读取流量预测…</p>
          </div>
        ) : (
          data && (
            <>
              {!uuid && (
                <>
                  <div className="nf-kpis">
                    <div>
                      <span>监测节点</span>
                      <strong>
                        {nodes.length}
                        <small>台</small>
                      </strong>
                      <p>按各节点账单周期统计</p>
                    </div>
                    <div className="is-critical">
                      <span>预计超额</span>
                      <strong>
                        {critical}
                        <small>台</small>
                      </strong>
                      <p>周期末预计超过限额</p>
                    </div>
                    <div className="is-warning">
                      <span>接近限额</span>
                      <strong>
                        {warning}
                        <small>台</small>
                      </strong>
                      <p>接近当前告警阈值</p>
                    </div>
                    <div className="is-safe">
                      <span>预算充足</span>
                      <strong>
                        {healthy}
                        <small>台</small>
                      </strong>
                      <p>当前预测处于安全范围</p>
                    </div>
                  </div>
                  <div className="nf-toolbar">
                    <div role="group" aria-label="流量风险筛选">
                      {[
                        ["all", "全部节点"],
                        ["risk", "需要关注"],
                        ["safe", "预算充足"],
                        ["unlimited", "未设限额"],
                        ["collecting", "积累样本"],
                        ["error", "数据异常"],
                      ].map(([key, label]) => (
                        <button
                          type="button"
                          key={key}
                          aria-pressed={filter === key}
                          onClick={() => setFilter(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="nf-search">
                      <Search size={15} />
                      <input
                        aria-label="搜索预测节点"
                        placeholder="搜索节点或分组"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                  </div>
                </>
              )}
              {selected ? (
                <>
                  <div className="nf-main">
                    <div className="nf-trend">
                      <div className="nf-trend-heading">
                        <div>
                          <span className="nf-eyebrow">账单周期趋势</span>
                          <h3>
                            {selected.node_name}
                            <span>
                              {MODE_LABELS[selected.traffic_limit_type]}
                            </span>
                          </h3>
                          <p>
                            {selected.cycle.cycleStart} —{" "}
                            {selected.cycle.cycleEnd} · UTC
                            {(data.summary.timezone_offset ?? 8) >= 0
                              ? "+"
                              : ""}
                            {data.summary.timezone_offset ?? 8}
                          </p>
                        </div>
                        {!uuid && (
                          <select
                            aria-label="选择预测节点"
                            value={selected.node_id}
                            onChange={(event) =>
                              setSelectedId(event.target.value)
                            }
                          >
                            {visible.map((node) => (
                              <option key={node.node_id} value={node.node_id}>
                                {node.node_name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {selected.fetch_failed ? (
                        <div className="nf-chart-empty">
                          <Info size={25} />
                          <strong>历史数据暂时不可用</strong>
                          <p>本周期预测将在数据恢复后显示</p>
                          <button
                            type="button"
                            className="nf-action"
                            onClick={refresh}
                          >
                            重新读取
                          </button>
                        </div>
                      ) : (
                        <ForecastChart node={selected} />
                      )}
                      <div className="nf-direction-totals">
                        <span>
                          <ArrowDownLeft size={14} />
                          周期入站{" "}
                          <b>{traffic(selected.cumulative.in_bytes)}</b>
                        </span>
                        <span>
                          <ArrowUpRight size={14} />
                          周期出站{" "}
                          <b>{traffic(selected.cumulative.out_bytes)}</b>
                        </span>
                        <span>
                          <CalendarClock size={13} />
                          有效样本 {sampleDays(selected)} / 7 天
                          {Boolean(selected.partial_days) && <span title="采样不足一天的记录仍计入实际用量，但不参与日均预测"> · {selected.partial_days} 天采样不完整</span>}
                        </span>
                      </div>
                    </div>
                    <BudgetSummary node={selected} />
                  </div>

                  {!uuid && (
                    <div className="nf-node-list">
                      <div className="nf-list-heading">
                        <h3>节点流量预算</h3>
                        <span>{visible.length} 个节点</span>
                      </div>
                      <div className="nf-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>节点</th>
                              <th>本周期已用</th>
                              <th>周期末预计</th>
                              <th>流量限额</th>
                              <th>重置时间</th>
                              <th>状态</th>
                              <th>
                                <span className="sr-only">详情</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((node) => (
                              <tr
                                key={node.node_id}
                                className={
                                  node.node_id === selected.node_id
                                    ? "is-selected"
                                    : ""
                                }
                              >
                                <td>
                                  <button
                                    type="button"
                                    className="nf-node-name"
                                    onClick={() => setSelectedId(node.node_id)}
                                  >
                                    {node.node_name}
                                  </button>
                                  <small>
                                    {MODE_LABELS[node.traffic_limit_type]}
                                  </small>
                                </td>
                                <td>
                                  {traffic(node.cumulative.billable_bytes)}
                                </td>
                                <td className={`is-${forecastState(node)}`}>
                                  {node.fetch_failed
                                    ? "—"
                                    : traffic(node.projected.billable_bytes)}
                                  {node.has_quota && !node.fetch_failed && (
                                    <small>
                                      {projectedPercent(node)}% 的配额
                                    </small>
                                  )}
                                </td>
                                <td>
                                  {node.has_quota
                                    ? traffic(node.traffic_limit_bytes)
                                    : "未设置"}
                                </td>
                                <td>
                                  {node.cycle.cycleEnd
                                    .slice(5)
                                    .replace("-", "/")}
                                  <small>{node.cycle.daysRemaining} 天后</small>
                                </td>
                                <td>
                                  <StateBadge node={node} />
                                </td>
                                <td>
                                  <Link
                                    to={`/instance/${node.node_id}#forecast`}
                                    onClick={(event) => {
                                      if (onOpenNode) {
                                        event.preventDefault();
                                        onOpenNode(node.node_id);
                                      }
                                    }}
                                    aria-label={`查看 ${node.node_name} 的流量预测`}
                                  >
                                    <ExternalLink size={14} />
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="nf-empty">
                  <Search size={25} />
                  <p>
                    {uuid
                      ? "该节点暂无预测数据"
                      : "没有匹配的节点，请调整筛选条件"}
                  </p>
                </div>
              )}
              <footer className="nf-footer">
                <span>近 7 天加权趋势估算 · 虚线为预测值</span>
                <span>
                  {updated ? `快照更新 ${updated}` : "基于最近保存的快照"}
                  <a
                    href="https://github.com/livingfree2023/Komari-Plugin-NetForecast"
                    target="_blank"
                    rel="noreferrer"
                  >
                    NetForecast <ExternalLink size={11} />
                  </a>
                </span>
              </footer>
            </>
          )
        )}
      </>
    </Card>
  );
}
