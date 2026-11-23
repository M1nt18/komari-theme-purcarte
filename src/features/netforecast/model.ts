import type { BillingMode, NodeForecast } from "./types";

export const GIB = 1024 ** 3;
export const MODE_LABELS: Record<BillingMode, string> = {
  sum: "双向求和",
  max: "双向取大",
  min: "双向取小",
  upload: "仅出站",
  up: "仅出站",
  download: "仅入站",
  down: "仅入站",
};

export type ForecastState =
  | "critical"
  | "warning"
  | "safe"
  | "unlimited"
  | "collecting"
  | "error";
export const STATE_LABELS: Record<ForecastState, string> = {
  critical: "预计超额",
  warning: "接近限额",
  safe: "预算充足",
  unlimited: "未设限额",
  collecting: "积累样本",
  error: "数据异常",
};

export function sampleDays(node: NodeForecast) {
  if (node.sample_days !== undefined) return node.sample_days;
  return Math.min(
    7,
    node.chart_series.filter(
      (point) => point.has_data && !point.is_today && !point.is_forecast,
    ).length,
  );
}

export function forecastState(node: NodeForecast): ForecastState {
  if (node.fetch_failed) return "error";
  if (!node.has_quota) return "unlimited";
  if (node.cumulative.billable_bytes >= node.traffic_limit_bytes)
    return "critical";
  if (node.collecting_samples ?? (sampleDays(node) < 7)) return "collecting";
  if (node.forecast_available === false) return "error";
  return {
    CRITICAL: "critical",
    WARNING: "warning",
    SAFE: "safe",
    NO_QUOTA: "unlimited",
  }[node.status] as ForecastState;
}

export function traffic(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1024 * GIB) return `${(value / (1024 * GIB)).toFixed(2)} TB`;
  if (value >= GIB)
    return `${(value / GIB).toFixed(value >= 100 * GIB ? 0 : 1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(value / 1024))} KB`;
}

export function projectedPercent(node: NodeForecast) {
  return node.has_quota && !node.fetch_failed && node.forecast_available !== false
    ? Math.round(
        (node.projected.billable_bytes / node.traffic_limit_bytes) * 100,
      )
    : null;
}

export function chartData(node: NodeForecast) {
  return node.chart_series.map((point) => {
    const billable =
      point.cumulative_billable == null
        ? null
        : point.cumulative_billable / GIB;
    return {
      date: point.date,
      label: point.date.slice(5).replace("-", "/"),
      incoming:
        !point.is_forecast && point.has_data ? point.in_bytes / GIB : null,
      outgoing:
        !point.is_forecast && point.has_data ? point.out_bytes / GIB : null,
      actual: !point.is_forecast && point.has_data ? billable : null,
      predicted: point.is_forecast || point.is_today ? billable : null,
      today: Boolean(point.is_today),
      forecast: Boolean(point.is_forecast),
    };
  });
}
