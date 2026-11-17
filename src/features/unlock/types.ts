export type IpFamily = "combined" | "ipv4" | "ipv6";

export interface UnlockResult {
  status: string;
  unlocked: boolean;
  region: string;
  info?: string;
  raw?: string;
}

export interface UnlockService {
  id: string;
  name: string;
  displayName?: string;
  regionId: string;
  regionKey?: string;
  ipv4: UnlockResult | null;
  ipv6: UnlockResult | null;
  auto: UnlockResult | null;
  unlocked: boolean;
  region: string;
}

export interface UnlockNode {
  uuid: string;
  name: string;
  updatedAt: string | null;
  firstSuccessAt?: string | null;
  error?: string | null;
  workerInstalled?: boolean;
  workerOnline?: boolean;
  services: UnlockService[];
}

export interface UnlockSnapshot {
  schemaVersion: number;
  preview?: boolean;
  manualExecutionRequired?: boolean;
  autoProbe?: boolean;
  updatedAt: string | null;
  activeTask: { clients: string[]; phase?: string } | null;
  regionsCatalog: { id: string; nameZh: string; nameEn: string }[];
  nodes: Record<string, UnlockNode>;
}
