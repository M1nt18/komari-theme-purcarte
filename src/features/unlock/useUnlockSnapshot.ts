import { useEffect, useState } from "react";
import type { UnlockSnapshot } from "./types";

type SnapshotState = {
  snapshot: UnlockSnapshot | null;
  loading: boolean;
  testing: boolean;
  canProbe: boolean;
  error: string | null;
};

export function useUnlockSnapshot(uuid: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SnapshotState>({
    snapshot: null,
    loading: true,
    testing: false,
    canProbe: false,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let canProbe = false;
    let isAdmin = false;

    async function request(path: string, init: RequestInit = {}) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 12000);
      try {
        const response = await fetch(path, {
          ...init,
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, timeout.signal]),
        });
        if (
          !response.headers.get("content-type")?.includes("application/json")
        ) {
          throw new Error(
            "暂时无法读取检测结果，请确认 UnlockTest 已安装并启用。",
          );
        }
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? "请以管理员身份登录后开始检测。"
              : payload.message || "暂时无法读取检测结果，请稍后重试。",
          );
        }
        return payload;
      } finally {
        clearTimeout(timer);
      }
    }

    async function readSnapshot(): Promise<UnlockSnapshot> {
      const payload = await request("/api/plugin/unlock-test/snapshot");
      if (
        payload.status !== "success" ||
        !payload.data?.nodes ||
        typeof payload.data.nodes !== "object" ||
        Array.isArray(payload.data.nodes)
      ) {
        throw new Error("解锁结果格式异常，请稍后重试。");
      }
      return payload.data;
    }

    function fail(error: unknown) {
      if (!active) return;
      setState((previous) => ({
        ...previous,
        loading: false,
        testing: false,
        error:
          error instanceof Error && error.name !== "AbortError"
            ? error.message
            : "读取检测结果超时，请稍后重试。",
      }));
    }

    function showSnapshot(snapshot: UnlockSnapshot) {
      canProbe = !snapshot.manualExecutionRequired && snapshot.nodes[uuid]?.workerInstalled !== false && Boolean(snapshot.preview || isAdmin);
      const testing = snapshot.activeTask?.clients?.includes(uuid) ?? false;
      if (active)
        setState({ snapshot, testing, canProbe, loading: false, error: null });
      return testing;
    }

    async function pollResult() {
      try {
        const snapshot = await readSnapshot();
        if (!active) return;
        if (showSnapshot(snapshot)) {
          pollTimer = setTimeout(pollResult, snapshot.preview ? 500 : 3000);
        } else if (snapshot.nodes[uuid]?.workerInstalled === false) {
          pollTimer = setTimeout(pollResult, 15000);
        }
      } catch (error) {
        fail(error);
      }
    }

    async function initialize() {
      setState((previous) => ({
        ...previous,
        loading: !previous.snapshot,
        error: null,
      }));
      try {
        const [snapshot, identity] = await Promise.all([
          readSnapshot(),
          request("/api/me").catch(() => ({ logged_in: false })),
        ]);
        if (!active) return;
        isAdmin = Boolean(identity.logged_in);
        const node = snapshot.nodes[uuid];
        canProbe = !snapshot.manualExecutionRequired && node?.workerInstalled !== false && Boolean(snapshot.preview || identity.logged_in);
        const succeeded = Boolean(
          node?.firstSuccessAt ||
            (node?.updatedAt && node.services?.length && !node.error),
        );
        const alreadyRunning = showSnapshot(snapshot);
        const firstDetection = snapshot.autoProbe !== false && !succeeded && !snapshot.activeTask;

        if (
          attempt === 0 &&
          !succeeded &&
          canProbe &&
          snapshot.activeTask &&
          !alreadyRunning
        ) {
          pollTimer = setTimeout(initialize, snapshot.preview ? 500 : 3000);
          return;
        }

        if (!alreadyRunning && canProbe && (attempt > 0 || firstDetection)) {
          setState((previous) => ({ ...previous, testing: true }));
          const response = await request("/api/plugin/unlock-test/probe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clients: [uuid], onlyIfMissing: attempt === 0 }),
          });
          if (response.status !== "success") {
            throw new Error(
              response.message || "暂时无法开始检测，请稍后重试。",
            );
          }
          if (response.data?.reason === "already_running" && !alreadyRunning) {
            throw new Error("其他检测正在运行，请稍后再试。");
          }
          if (active) await pollResult();
        } else if (alreadyRunning) {
          pollTimer = setTimeout(pollResult, snapshot.preview ? 500 : 3000);
        } else if (node?.workerInstalled === false) {
          pollTimer = setTimeout(pollResult, 15000);
        }
      } catch (error) {
        fail(error);
      }
    }

    void initialize();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(pollTimer);
    };
  }, [uuid, attempt]);

  const refresh = () => {
    setState((previous) => ({
      ...previous,
      testing: previous.canProbe,
      loading: !previous.canProbe,
      error: null,
    }));
    setAttempt((value) => value + 1);
  };

  return { ...state, refresh };
}
