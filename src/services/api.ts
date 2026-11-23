// API 服务 - 用于与 Komari 后端通信
import type {
  NodeData,
  ApiResponse,
  PublicInfo,
  HistoryRecord,
  PingHistoryResponse,
  Me,
  NodeStats,
} from "@/types/node";
import type { RpcNodeStatus, RpcNodeStatusMap } from "@/types/rpc";
import { convertNodeStatsToRpcNodeStatus } from "../utils/converters.ts";
import type { SiteStatus } from "@/config/default";
import { readStartup } from "./startup.ts";
import { historyPointLimit, readRpcLoadHistory } from "../features/monitoring/load-history.ts";

class ApiService {
  private baseUrl: string;
  private readonly requestTimeoutMs = 10000;
  public useRpc = false;
  private rpcCallId = 1;

  constructor() {
    this.baseUrl = "";
  }

  private fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit = {}
  ): Promise<Response> {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const request = fetch(
      input,
      controller ? { ...init, signal: controller.signal } : init
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error("API request timed out"));
      }, this.requestTimeoutMs);
    });

    return Promise.race([request, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private async rpcCall<T>(
    method: string,
    params: any = {}
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/rpc2`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
          params,
          id: this.rpcCallId++,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const rpcResponse = await response.json();
      if (rpcResponse.error) {
        throw new Error(
          `RPC Error: ${rpcResponse.error.message} (Code: ${rpcResponse.error.code})`
        );
      }
      return { status: "success", message: "", data: rpcResponse.result };
    } catch (error) {
      console.error(`RPC call to '${method}' failed:`, error);
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown RPC error",
        data: null as any,
      };
    }
  }

  async get<T>(
    endpoint: string
  ): Promise<ApiResponse<T> | { status: string; message: string; data: any }> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}${endpoint}`);
      if (!response.ok) {
        return {
          status: "error",
          message: `HTTP error! status: ${response.status}`,
          data: null as any,
        };
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed (network error):", error);
      return {
        status: "error",
        message:
          error instanceof Error ? error.message : "Unknown network error",
        data: null as any,
      };
    }
  }

  // 获取所有节点信息
  async getNodes(): Promise<NodeData[]> {
    if (this.useRpc) {
      const response = await this.rpcCall<{ [uuid: string]: NodeData }>(
        "common:getNodes"
      );
      if (response.status === "success" && response.data && typeof response.data === "object") {
        return Object.values(response.data);
      }
      throw new Error(response.message || "Invalid nodes response");
    }
    return readStartup<NodeData[]>("/api/nodes", Array.isArray);
  }

  // 获取指定节点的最近状态
  async getNodeRecentStats(uuid: string): Promise<RpcNodeStatus[]> {
    if (this.useRpc) {
      const response = await this.rpcCall<{ records: RpcNodeStatus[] }>(
        "common:getNodeRecentStatus",
        { uuid }
      );
      return response.status === "success" ? response.data.records : [];
    }
    const response = await this.get<NodeStats[]>(`/api/recent/${encodeURIComponent(uuid)}`);
    if (response.status === "success" && Array.isArray(response.data)) {
      return response.data.map((stats) =>
        convertNodeStatsToRpcNodeStatus(stats, uuid, true)
      );
    }
    return [];
  }

  // 获取负载历史记录
  async getLoadHistory(
    uuid: string,
    hours: number = 24
  ): Promise<{ count: number; records: HistoryRecord[] } | null> {
    const maxCount = historyPointLimit(hours);
    if (this.useRpc || maxCount !== undefined) {
      const response = await this.rpcCall<Parameters<typeof readRpcLoadHistory>[0]>("common:getRecords", {
        uuid,
        hours,
        type: "load",
        ...(maxCount === undefined ? {} : { maxCount }),
      });
      const history = response.status === "success" ? readRpcLoadHistory(response.data, uuid) : null;
      if (history) return history;
    }
    const response = await this.get<{
      count: number;
      records: HistoryRecord[];
    }>(`/api/records/load?uuid=${encodeURIComponent(uuid)}&hours=${hours}`);
    return response.status === "success" ? response.data : null;
  }

  // 获取 Ping 历史记录
  async getPingHistory(
    uuid: string,
    hours: number = 24
  ): Promise<PingHistoryResponse | null> {
    if (this.useRpc) {
      const response = await this.rpcCall<any>("common:getRecords", {
        uuid,
        hours,
        type: "ping",
      });
      if (response.status === "success" && response.data) {
        if (response.data[uuid]) {
          return {
            count: response.data[uuid].length,
            records: response.data[uuid],
            tasks: response.data.tasks,
          };
        }
        return response.data;
      }
      return null;
    }
    const response = await this.get<PingHistoryResponse>(
      `/api/records/ping?uuid=${encodeURIComponent(uuid)}&hours=${hours}`
    );
    return response.status === "success" ? response.data : null;
  }

  // 获取公开设置
  async getPublicSettings(): Promise<PublicInfo | null> {
    if (this.useRpc) {
      const response = await this.rpcCall<PublicInfo>("common:getPublicInfo");
      return response.status === "success" ? response.data : null;
    }
    const response = await this.get<PublicInfo>("/api/public");
    return response.status === "success" ? response.data : null;
  }

  // 获取版本信息
  async getVersion(): Promise<{ version: string; hash: string }> {
    if (this.useRpc) {
      const response = await this.rpcCall<{ version: string; hash: string }>(
        "common:getVersion"
      );
      if (response.status === "success" && response.data) {
        return response.data;
      }
    }
    const response = await this.get<{ version: string; hash: string }>(
      "/api/version"
    );
    return response.status === "success"
      ? response.data
      : { version: "unknown", hash: "unknown" };
  }

  // 获取用户信息
  async getUserInfo(): Promise<Me | null> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/me`);
      if (!response.ok) {
        return null;
      }
      const data: Me = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed (network error):", error);
      return null;
    }
  }

  // 检查站点状态
  async checkSiteStatus(): Promise<{
    status: SiteStatus;
    publicInfo: PublicInfo | null;
  }> {
    const [publicInfoResponse, meResponse] = await Promise.all([
      this.getPublicSettings(),
      this.getUserInfo(),
    ]);
    const isLoggedIn = meResponse?.logged_in || false;

    if (publicInfoResponse) {
      if (publicInfoResponse.private_site) {
        if (isLoggedIn) {
          return {
            status: "private-authenticated",
            publicInfo: publicInfoResponse,
          };
        }
        return {
          status: "private-unauthenticated",
          publicInfo: publicInfoResponse,
        };
      } else {
        if (isLoggedIn) {
          return { status: "authenticated", publicInfo: publicInfoResponse };
        }
        return { status: "public", publicInfo: publicInfoResponse };
      }
    }
    return { status: "private-unauthenticated", publicInfo: null };
  }

  async saveThemeSettings(
    theme: string,
    settings: Partial<any>
  ): Promise<ApiResponse<any>> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/admin/theme/settings?theme=${encodeURIComponent(theme)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(settings),
        }
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Failed to save theme settings:", error);
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        data: null,
      };
    }
  }
}

// 创建 API 服务实例
export const apiService = new ApiService();

// WebSocket 连接管理
export class WebSocketService {
  private ws: WebSocket | null = null;
  private retryDelayMs = 2000;
  private listeners: Set<(data: any) => void> = new Set();
  private url: string;
  private statusInterval: ReturnType<typeof setInterval> | null = null;
  private rpcCallId = 1;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rpcMode = false;
  get useRpc() { return this.rpcMode; }
  set useRpc(value: boolean) {
    if (value === this.rpcMode) return;
    this.rpcMode = value;
    if (!this.stopped) { this.disconnect(); this.connect(); }
  }

  constructor(url: string = "") {
    this.url = url;
  }

  connect() {
    if (this.stopped) {
      this.stopped = false;
      globalThis.window?.addEventListener("online", this.resume);
      globalThis.document?.addEventListener("visibilitychange", this.onVisibilityChange);
    }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws && this.ws.readyState < 2) {
      return;
    }

    const endpoint = this.useRpc ? "/api/rpc2" : "/api/clients";
    const wsUrl =
      this.url ||
      `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
        window.location.host
      }${endpoint}`;

    try {
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      this.ws.onopen = () => {
        if (this.ws !== socket || this.stopped) return;
        console.log(`WebSocket connected to ${endpoint}`);
        this.retryDelayMs = 2000;
        this.sendUpdateRequest();
        this.startStatusUpdates();
      };

      this.ws.onmessage = (event) => {
        if (this.ws !== socket || this.stopped) return;
        try {
          const data = JSON.parse(event.data);
          if (this.useRpc) {
            if (data.result) {
              this.listeners.forEach((listener) => listener(data.result));
            }
          } else {
            if (data.status === "success" && data.data) {
              const oldData = data.data as {
                online: string[];
                data: { [uuid: string]: NodeStats };
              };
              if (Array.isArray(oldData.online) && oldData.data) {
                const online = new Set(oldData.online);
                const convertedData: RpcNodeStatusMap = {};
                for (const uuid in oldData.data) {
                  convertedData[uuid] = convertNodeStatsToRpcNodeStatus(
                    oldData.data[uuid],
                    uuid,
                    online.has(uuid)
                  );
                }
                this.listeners.forEach((listener) => listener(convertedData));
              }
            }
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      this.ws.onclose = () => {
        if (this.ws !== socket || this.stopped) return;
        this.ws = null;
        console.log("WebSocket disconnected");
        this.stopStatusUpdates();
        this.reconnect();
      };

      this.ws.onerror = (error) => {
        if (this.ws !== socket || this.stopped) return;
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
      this.reconnect();
    }
  }

  private reconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.retryDelayMs);
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30000);
  }

  private send(data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private sendUpdateRequest() {
    if (globalThis.document?.hidden) return;
    if (this.useRpc) {
      const rpcRequest = {
        jsonrpc: "2.0",
        method: "common:getNodesLatestStatus",
        id: this.rpcCallId++,
      };
      this.send(JSON.stringify(rpcRequest));
    } else {
      this.send("get");
    }
  }

  subscribe(listener: (data: any) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {
    this.stopped = true;
    this.retryDelayMs = 2000;
    globalThis.window?.removeEventListener("online", this.resume);
    globalThis.document?.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const socket = this.ws;
    this.ws = null;
    this.stopStatusUpdates();
    socket?.close();
  }

  private startStatusUpdates() {
    this.stopStatusUpdates();
    this.statusInterval = setInterval(() => {
      this.sendUpdateRequest();
    }, 2000);
  }

  private stopStatusUpdates() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  private onVisibilityChange = () => {
    if (!globalThis.document?.hidden) this.resume();
  };

  private resume = () => {
    if (this.stopped) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUpdateRequest();
    } else if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
      this.retryDelayMs = 2000;
      this.connect();
    }
  };
}

// 延迟 WebSocket 服务实例的创建
let wsServiceInstance: WebSocketService | null = null;

export function getWsService(): WebSocketService {
  if (!wsServiceInstance) {
    wsServiceInstance = new WebSocketService();
  }
  return wsServiceInstance;
}
