import { type ReactNode, useCallback, useMemo, useEffect } from "react";
import { useAppConfig } from "@/config/hooks";
import { useIsMobile } from "@/hooks/useMobile";
import { useTheme } from "@/hooks/useTheme";

function mediaUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value, document.baseURI);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function DynamicContent({ children }: { children: ReactNode }) {
  const config = useAppConfig();
  const isMobile = useIsMobile();
  const { appearance } = useTheme();

  const getUrlFromConfig = useCallback(
    (urls: string) => {
      if (!urls) return "";
      const urlList = urls.split("|").map((u) => u.trim());
      return mediaUrl(urlList.length > 1 && appearance === "dark" ? urlList[1] : urlList[0]);
    },
    [appearance]
  );

  const imageUrl = useMemo(() => {
    if (!config) return "";
    const { backgroundImage, backgroundImageMobile } = config;
    return isMobile && backgroundImageMobile
      ? getUrlFromConfig(backgroundImageMobile)
      : getUrlFromConfig(backgroundImage);
  }, [config, isMobile, getUrlFromConfig]);

  const videoUrl = useMemo(() => {
    if (!config || !config.enableVideoBackground) return "";
    const { videoBackgroundUrl, videoBackgroundUrlMobile } = config;
    return isMobile && videoBackgroundUrlMobile
      ? getUrlFromConfig(videoBackgroundUrlMobile)
      : getUrlFromConfig(videoBackgroundUrl);
  }, [config, isMobile, getUrlFromConfig]);

  const { mainWidth, blurValue, blurBackgroundColor, enableBlur } = config;
  useEffect(() => {
    const styles = document.documentElement.style;
    const [light, dark = light] = blurBackgroundColor.split("|").map(color => color.trim());
    styles.setProperty("--purcarte-blur", `${enableBlur ? blurValue : 0}px`);
    styles.setProperty("--wide-main-width", `calc(${Math.min(100, mainWidth + 5)}vw - var(--active-settings-width, 0px))`);
    for (const [name, color] of [["--card-light", light], ["--card-dark", dark]]) {
      if (CSS.supports("color", color)) styles.setProperty(name, color);
      else styles.removeProperty(name);
    }
    return () => {
      for (const name of ["--purcarte-blur", "--wide-main-width", "--card-light", "--card-dark"]) {
        styles.removeProperty(name);
      }
    };
  }, [mainWidth, blurValue, blurBackgroundColor, enableBlur]);

  useEffect(() => {
    const imageBackground = document.getElementById("image-background");
    const videoBackground = document.getElementById(
      "video-background"
    ) as HTMLVideoElement;
    const [size, position] = config.backgroundAlignment
      .split(",")
      .map((s) => s.trim());

    if (imageBackground) {
      imageBackground.style.backgroundImage = imageUrl ? `url(${JSON.stringify(imageUrl)})` : "";
      imageBackground.style.backgroundSize = size;
      imageBackground.style.backgroundPosition = position;
    }

    if (videoBackground) {
      if (config.enableVideoBackground && videoUrl) {
        videoBackground.src = videoUrl;
        videoBackground.style.objectFit = size;
        videoBackground.style.objectPosition = position;
        videoBackground.style.display = "block";
      } else {
        videoBackground.style.display = "none";
      }
    }
  }, [
    imageUrl,
    videoUrl,
    config.backgroundAlignment,
    config.enableVideoBackground,
  ]);

  return <div className="fade-in">{children}</div>;
}
