export interface CycleInput {
  limit_bytes: number;
  used_bytes: number;
  period_start: string;
  period_end: string;
}

export function cycleProgress(quota: CycleInput, serverNow: number) {
  const start = Date.parse(quota.period_start);
  const end = Date.parse(quota.period_end);
  const validPeriod = Number.isFinite(start) && Number.isFinite(end) && end > start;
  const validUsage = Number.isFinite(quota.used_bytes) && quota.used_bytes >= 0
    && Number.isFinite(quota.limit_bytes) && quota.limit_bytes >= 0;
  const limited = quota.limit_bytes > 0;
  const current = validPeriod && validUsage && Number.isFinite(serverNow) && serverNow >= start && serverNow < end;
  const elapsed = current ? Math.max(0, Math.min(100, (serverNow-start)/(end-start)*100)) : null;
  const usage = validUsage && limited && current ? quota.used_bytes/quota.limit_bytes*100 : null;
  return {
    limited, current, elapsed, usage,
    fill: usage === null ? 0 : Math.max(0, Math.min(100, usage)),
    remainingDays: current ? Math.max(0, Math.ceil((end-serverNow)/86400000)) : null,
    tone: usage !== null && usage >= 100 ? 'exhausted'
      : usage !== null && elapsed !== null && usage > elapsed ? 'warning' : 'normal',
  };
}

export function cycleDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
  }) : '—';
}

export function precisePercent(value: number) {
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${value.toFixed(1)}%`;
}
