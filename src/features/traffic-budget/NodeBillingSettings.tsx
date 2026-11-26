import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trafficStore } from "../../../integrations/traffic-ledger/traffic-store.mjs";

type BillingSettings = {
  reset_day: number;
  period_start: string;
  calibrated_gib: number | null;
};
const endpoint = "/api/purcarte/billing";

async function loadSettings(path: string, options: RequestInit): Promise<BillingSettings> {
  const response = await fetch(path, { ...options, cache: "no-store", credentials: "same-origin" });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.status !== "success" || !data.data) {
    throw new Error(data?.message || "无法读取或保存流量设置，请稍后重试。");
  }
  return data.data;
}

export function NodeBillingSettings({ uuid }: { uuid: string }) {
  const [saved, setSaved] = useState<BillingSettings | null>(null);
  const [day, setDay] = useState("");
  const [used, setUsed] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);

  function apply(value: BillingSettings) {
    setSaved(value);
    setDay(String(value.reset_day));
    setUsed(value.calibrated_gib === null ? "" : String(value.calibrated_gib));
  }

  useEffect(() => {
    const controller = new AbortController();
    setSaved(null);
    setError("");
    setStatus("");
    void loadSettings(`${endpoint}?uuid=${encodeURIComponent(uuid)}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) apply(value); })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [uuid, revision]);

  const newDay = Number(day);
  const newUsed = used.trim() === "" ? null : Number(used);
  const valid = Number.isInteger(newDay) && newDay >= 1 && newDay <= 31 &&
    (newUsed === null || (Number.isFinite(newUsed) && newUsed >= 0 && newUsed < 2 ** 33));
  const changed = saved && (newDay !== saved.reset_day || newUsed !== saved.calibrated_gib);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || !valid || !changed || saving) return;
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const body = {
        uuid, period_start: saved.period_start,
        ...(newDay !== saved.reset_day ? { reset_day: newDay } : {}),
        ...(newUsed !== saved.calibrated_gib ? { used_gib: newUsed } : {}),
      };
      apply(await loadSettings(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      setStatus("流量设置已保存");
      void trafficStore.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return <form className="space-y-3 p-4" onSubmit={submit}>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {!saved && (error
      ? <Button type="button" variant="outline" onClick={() => setRevision(v => v + 1)}>重新读取</Button>
      : <p role="status">正在读取流量设置…</p>)}
    {saved && <>
      <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="font-medium">每月重置日</span>
          <Input className="border" type="number" min="1" max="31" required value={day} onChange={e => setDay(e.target.value)} />
          <span className="block text-xs text-secondary-foreground">北京时间 00:00 重置。短月按月底处理。</span>
        </label>
        <label className="space-y-1.5">
          <span className="font-medium">本期已用流量校准（GiB）</span>
          <Input className="border" type="number" min="0" step="any" value={used} onChange={e => setUsed(e.target.value)} />
          <span className="block text-xs text-secondary-foreground">填入当前账期已用总量，之后继续累计。清空后按历史采样计算。</span>
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!valid || !changed || saving}>{saving ? "保存中…" : "保存流量设置"}</Button>
        {error && <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setRevision(v => v + 1)}>重新读取</Button>}
        <span role="status" className="text-secondary-foreground">{status}</span>
      </div>
    </>}
  </form>;
}
