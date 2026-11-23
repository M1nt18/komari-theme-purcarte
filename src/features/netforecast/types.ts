export type BillingMode =
  | "sum"
  | "max"
  | "min"
  | "upload"
  | "download"
  | "up"
  | "down";

export interface TrafficPoint {
  date: string;
  timestamp: number;
  in_bytes: number;
  out_bytes: number;
  total_bytes: number;
  cumulative_billable: number | null;
  has_data?: boolean;
  is_forecast?: boolean;
  is_today?: boolean;
}

export interface NodeForecast {
  sample_days?: number;
  collecting_samples?: boolean;
  partial_days?: number;
  forecast_available?: boolean;
  history_partial?: boolean;
  period_end?: string;
  node_id: string;
  node_name: string;
  group?: string;
  has_quota: boolean;
  traffic_limit_bytes: number;
  traffic_limit_type: BillingMode;
  traffic_reset_day: number;
  cycle: {
    cycleStart: string;
    cycleEnd: string;
    daysTotal: number;
    daysElapsed: number;
    daysRemaining: number;
  };
  cumulative: { in_bytes: number; out_bytes: number; billable_bytes: number };
  daily_avg: { in_bytes: number; out_bytes: number; billable_bytes: number };
  projected: { in_bytes: number; out_bytes: number; billable_bytes: number };
  usage_ratio: number;
  status: "SAFE" | "WARNING" | "CRITICAL" | "NO_QUOTA";
  days_until_exhaustion?: number;
  exhaustion_date?: string;
  warning_message?: string;
  chart_series: TrafficPoint[];
  fetch_failed?: boolean;
  fetch_error?: string | null;
}

export interface ForecastOverview {
  last_sync?: string;
  ok: boolean;
  preview?: boolean;
  generated_at?: string;
  summary: { total_nodes: number; timezone_offset: number };
  nodes: NodeForecast[];
}
