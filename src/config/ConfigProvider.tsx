import { type ReactNode, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { normalizeSettings } from './settings-model';
import type { PublicInfo } from "@/types/node.d";
import { ConfigContext } from "./ConfigContext";
import { DEFAULT_CONFIG, type ConfigOptions, type SiteStatus } from "./default";
import { apiService, getWsService } from "@/services/api";
import Loading from "@/components/loading";
import { defaultTexts, otherTexts } from "./locales";
import { mergeTexts, deepMerge } from "@/utils/localeUtils";
import { readStartup } from "@/services/startup";

const isPublicInfo = (value: unknown): value is PublicInfo =>
  Boolean(value && typeof value === "object" && "private_site" in value &&
    typeof value.private_site === "boolean");

// 配置提供者属性类型
interface ConfigProviderProps {
  children: ReactNode;
}

/**
 * 配置提供者组件，用于将配置传递给子组件
 */
export function ConfigProvider({ children }: ConfigProviderProps) {
  const [publicSettings, setPublicSettings] = useState<PublicInfo | null>(null);
  const [config, setConfig] = useState<ConfigOptions | null>(null);
  const [siteStatus, setSiteStatus] = useState<SiteStatus>("public");
  const [previewConfig, setPreviewConfig] =
    useState<Partial<ConfigOptions> | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const requestId = useRef(0);

  const loadConfig = useCallback(async () => {
    const request = ++requestId.current;
    setConfigFailed(false);
    const identity = apiService.getUserInfo();
    try {
      const publicInfo = await readStartup("/api/public", isPublicInfo);
      if (request !== requestId.current) return;
      const themeSettings = normalizeSettings(publicInfo.theme_settings);
      const mergedConfig = {
        ...DEFAULT_CONFIG,
        ...themeSettings,
        titleText: themeSettings.titleText || publicInfo.sitename || DEFAULT_CONFIG.titleText,
      };
      const applyIdentity = (loggedIn: boolean) => {
        if (request !== requestId.current) return;
        setSiteStatus(publicInfo.private_site
          ? (loggedIn ? "private-authenticated" : "private-unauthenticated")
          : (loggedIn ? "authenticated" : "public"));
      };
      if (publicInfo.private_site) applyIdentity(Boolean((await identity)?.logged_in));
      else {
        applyIdentity(false);
        void identity.then(user => applyIdentity(Boolean(user?.logged_in)));
      }
      if (request !== requestId.current) return;
      apiService.useRpc = false;
      getWsService().useRpc = false;

      // Initialize RPC
      if (mergedConfig.enableJsonRPC2Api) {
        const versionInfo = await apiService.getVersion();
        if (request !== requestId.current) return;
        if (versionInfo && versionInfo.version) {
          const match = versionInfo.version.match(/(\d+)\.(\d+)\.(\d+)/);
          if (match) {
            const [, major, minor, patch] = match.map(Number);
            if (
              major > 1 ||
              (major === 1 && minor > 0) ||
              (major === 1 && minor === 0 && patch >= 7)
            ) {
              apiService.useRpc = true;
              getWsService().useRpc = true;
              console.log("RPC has been enabled for API and WebSocket.");
            }
          }
        }
      }
      setPublicSettings(publicInfo);
      setConfig(mergedConfig);
    } catch (error) {
      console.error("Failed to initialize site:", error);
      if (request === requestId.current) setConfigFailed(true);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const texts = useMemo(() => {
    const activeConfig = previewConfig
      ? { ...config, ...previewConfig }
      : config;
    const baseTexts = activeConfig?.customTexts
      ? mergeTexts(defaultTexts, activeConfig.customTexts)
      : defaultTexts;
    return deepMerge(baseTexts, otherTexts);
  }, [config, previewConfig]);

  const updatePreviewConfig = useCallback((newConfig: Partial<ConfigOptions>) => {
    setPreviewConfig(newConfig);
  }, []);

  const reloadConfig = useCallback(async () => {
    await loadConfig();
  }, [loadConfig]);

  const activeConfig = useMemo(
    () =>
      previewConfig
        ? { ...(config || DEFAULT_CONFIG), ...previewConfig }
        : config || DEFAULT_CONFIG,
    [config, previewConfig]
  );

  const value = useMemo(() => ({
    ...activeConfig,
    titleText: activeConfig.titleText || publicSettings?.sitename || 'Komari',
    publicSettings,
    siteStatus,
    texts,
    previewConfig,
    updatePreviewConfig,
    reloadConfig,
  }), [activeConfig, publicSettings, siteStatus, texts, previewConfig, updatePreviewConfig, reloadConfig]);

  if (!config) {
    return (
      configFailed
        ? <div className="grid min-h-dvh place-content-center gap-3 text-center" role="alert">
            <p>暂时无法连接监控服务</p>
            <button type="button" className="rounded border px-3 py-2" onClick={() => void loadConfig()}>重试</button>
          </div>
        : <Loading text="加载配置中..." />
    );
  }

  return (
    <ConfigContext.Provider value={value}>
      {children}
    </ConfigContext.Provider>
  );
}
