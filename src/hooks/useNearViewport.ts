import { useEffect, useRef, useState } from "react";

export function useNearViewport(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasApproached, setHasApproached] = useState(false);

  useEffect(() => {
    if (!enabled || hasApproached) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setHasApproached(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setHasApproached(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, hasApproached]);

  return { ref, hasApproached };
}
