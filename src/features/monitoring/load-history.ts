import type { HistoryRecord } from "@/types/node";

type RpcLoadHistory = { count: number; records: { [uuid: string]: HistoryRecord[] } };

export function historyPointLimit(hours: number) {
  // The existing view uses an hourly grid for these ranges. Keep extra detail
  // on the wire so samples still align with that grid.
  return Number.isFinite(hours) && hours >= 168 ? Math.max(480, Math.ceil(hours * 1.5)) : undefined;
}

export function readRpcLoadHistory(payload: RpcLoadHistory | null, uuid: string) {
  if (!payload?.records || typeof payload.records !== "object") return null;
  const records = payload.records[uuid];
  if (Array.isArray(records)) return { records, count: records.length };
  return payload.count === 0 ? { records: [], count: 0 } : null;
}
