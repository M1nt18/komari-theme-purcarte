import type { IpFamily, UnlockResult, UnlockService } from "./types";

export type StatusTone = "success" | "restricted" | "blocked" | "unknown";

export interface ServiceStatus {
  label: string;
  tone: StatusTone;
  region: string;
  ipv6Only: boolean;
}

export function resultStatus(result?: UnlockResult | null): ServiceStatus {
  const rawRegion = result?.region ?? "";
  const region =
    /^[A-Z]{2,3}$/.test(rawRegion) && !["ERR", "BAN", "NO"].includes(rawRegion)
      ? rawRegion
      : "";
  if (result?.unlocked || result?.status === "YES") {
    return { label: "已解锁", tone: "success", region, ipv6Only: false };
  }
  if (result?.status === "RESTRICTED") {
    const label = /originals only/i.test(result.info ?? result.raw ?? "")
      ? "仅限自制剧"
      : "部分受限";
    return { label, tone: "restricted", region, ipv6Only: false };
  }
  if (result?.status === "NO" || result?.status === "BANNED") {
    return { label: "未解锁", tone: "blocked", region, ipv6Only: false };
  }
  return {
    label: result?.status === "ERR" ? "检测异常" : "未检测",
    tone: "unknown",
    region: "",
    ipv6Only: false,
  };
}

export function serviceStatus(
  service: UnlockService,
  family: IpFamily,
): ServiceStatus {
  if (family !== "combined") return resultStatus(service[family]);

  const results = [service.ipv4, service.ipv6, service.auto];
  const unlocked = results.find(
    (result) => resultStatus(result).tone === "success",
  );
  if (unlocked) {
    const status = resultStatus(unlocked);
    const ipv6Only =
      unlocked === service.ipv6 &&
      resultStatus(service.ipv4).tone !== "success" &&
      resultStatus(service.auto).tone !== "success";
    return {
      ...status,
      label: ipv6Only ? "仅 IPv6 解锁" : status.label,
      ipv6Only,
    };
  }
  const restricted = results.find((result) => result?.status === "RESTRICTED");
  if (restricted) return resultStatus(restricted);
  const blocked = results.find((result) =>
    ["NO", "BANNED"].includes(result?.status ?? ""),
  );
  if (blocked) return resultStatus(blocked);
  return resultStatus(results.find((result) => result?.status === "ERR"));
}

export function serviceKey(service: UnlockService) {
  return `${service.regionId}:${service.id}`;
}
