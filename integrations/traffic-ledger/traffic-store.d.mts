export interface TrafficQuota {
  used_bytes: number;
  remaining_bytes: number | null;
  limit_bytes: number;
  usage_percent: number;
  period_start: string;
  period_end: string;
  reset_day: number;
  billing_mode: 'sum' | 'max' | 'min' | 'up' | 'down';
  history_partial: boolean;
}
export const trafficStore: {
  get(uuid: string): TrafficQuota | undefined;
  getServerTime(): number;
  getSnapshot(): number;
  refresh(): Promise<void>;
  subscribe(callback: () => void): () => void;
};
export function quotaTitle(node: TrafficQuota | undefined): string;
