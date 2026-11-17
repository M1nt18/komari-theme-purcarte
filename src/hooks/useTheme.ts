import { useState, useEffect, useMemo, useCallback, createContext, useContext } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { useAppConfig } from "@/config";
import { DEFAULT_CONFIG, allAppearance, allColors } from "@/config/default";
import type { AppearanceType, ColorType, ViewModeType } from "@/config/default";

type themeAppearanceType = "light" | "dark";
const defaultThemeAppearance: themeAppearanceType = "light";

export interface ThemeContextType {
  appearance: themeAppearanceType;
  rawAppearance: AppearanceType;
  setAppearance: (appearance: AppearanceType) => void;
  color: ColorType;
  setColor: (color: ColorType) => void;
  viewMode: ViewModeType;
  setViewMode: (mode: ViewModeType) => void;
  statusCardsVisibility: {
    currentTime: boolean;
    currentOnline: boolean;
    regionOverview: boolean;
    trafficOverview: boolean;
    networkSpeed: boolean;
  };
  setStatusCardsVisibility: (
    visibility: Partial<ThemeContextType["statusCardsVisibility"]>
  ) => void;
}

export const ThemeContext = createContext<ThemeContextType>({
  appearance: defaultThemeAppearance,
  rawAppearance: DEFAULT_CONFIG.selectedDefaultAppearance as AppearanceType,
  setAppearance: () => {},
  color: DEFAULT_CONFIG.selectThemeColor as ColorType,
  setColor: () => {},
  viewMode: DEFAULT_CONFIG.selectedDefaultView as ViewModeType,
  setViewMode: () => {},
  statusCardsVisibility: {
    currentTime: true,
    currentOnline: true,
    regionOverview: true,
    trafficOverview: true,
    networkSpeed: true,
  },
  setStatusCardsVisibility: () => {},
});

/**
 * 将 Radix UI 的 "system" 外观转换为实际的 "light" 或 "dark" 外观
 * @param appearance - 上下文中的外观设置（"light"、"dark" 或 "system"）。
 * 返回 Radix UI 已解析的外观（ "light" 或 "dark"）
 */
export const useSystemTheme = (
  appearance: AppearanceType
): themeAppearanceType => {
  const [systemTheme, setSystemTheme] = useState<themeAppearanceType>(() => {
    // Initial system theme detection
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };

    // Add listener for system theme changes, including older mobile Safari.
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    // Cleanup
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  // Return the resolved theme
  if (appearance === "system") {
    return systemTheme;
  }

  return appearance as themeAppearanceType;
};

const useStoredState = <T>(
  key: string,
  defaultValue: T,
  validator?: (value: any) => value is T
): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const { enableLocalStorage, previewConfig } = useAppConfig();
  const read = () => {
    if (enableLocalStorage) {
      try {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          const value = JSON.parse(raw);
          if (!validator || validator(value)) return { key, value: value as T };
        }
      } catch { /* unavailable storage falls back to the configured value */ }
    }
    return null;
  };
  const [entry, setEntry] = useState(read);
  const previewing = Boolean(previewConfig && Object.keys(previewConfig).length);
  useEffect(() => {
    setEntry(read());
    // Defaults are returned directly; changing a site default never creates a browser preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enableLocalStorage]);
  useEffect(() => {
    if (enableLocalStorage && entry?.key === key && !previewing) {
      try { localStorage.setItem(key, JSON.stringify(entry.value)); } catch { /* optional browser preference */ }
    }
  }, [key, entry, enableLocalStorage, previewing]);
  const setValue = useCallback<React.Dispatch<React.SetStateAction<T>>>(next => {
    setEntry(previous => ({ key, value: typeof next === 'function'
      ? (next as (value:T)=>T)(previous?.key === key ? previous.value : defaultValue) : next }));
  }, [key, defaultValue]);
  return [previewing || !enableLocalStorage || entry?.key !== key ? defaultValue : entry.value, setValue];
};

export const useThemeManager = () => {
  const {
    selectedDefaultAppearance,
    selectThemeColor,
    selectedDefaultView,
    selectMobileDefaultView,
  } = useAppConfig();
  const defaultstatusCardsVisibility = useAppConfig().statusCardsVisibility;
  const isMobile = useIsMobile();

  const [appearance, setAppearance] = useStoredState<AppearanceType>(
    "appearance",
    selectedDefaultAppearance,
    (v): v is AppearanceType => allAppearance.includes(v)
  );

  const [color, setColor] = useStoredState<ColorType>(
    "color",
    selectThemeColor,
    (value): value is ColorType => allColors.includes(value)
  );

  const [viewMode, setViewMode] = useStoredState<ViewModeType>(
    isMobile ? "nodeViewMode:mobile" : "nodeViewMode",
    isMobile ? selectMobileDefaultView : selectedDefaultView,
    (value): value is ViewModeType => ['grid','compact','table'].includes(value)
  );


  const [statusCardsVisibility, setStatusCardsVisibility] = useStoredState(
    "statusCardsVisibility",
    useMemo(() => {
      const visibility: { [key: string]: boolean } = {};
      defaultstatusCardsVisibility.split(",").forEach((item) => {
        const [key, value] = item.split(":");
        visibility[key] = value === "true";
      });
      return visibility as ThemeContextType["statusCardsVisibility"];
    }, [defaultstatusCardsVisibility])
  );

  const handleSetStatusCardsVisibility = (
    newVisibility: Partial<ThemeContextType["statusCardsVisibility"]>
  ) => {
    setStatusCardsVisibility((prev) => ({ ...prev, ...newVisibility }));
  };



  const resolvedAppearance = useSystemTheme(appearance);

  return {
    appearance: resolvedAppearance,
    rawAppearance: appearance,
    setAppearance,
    color,
    setColor,
    viewMode,
    setViewMode,
    statusCardsVisibility,
    setStatusCardsVisibility: handleSetStatusCardsVisibility,
  };
};
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
