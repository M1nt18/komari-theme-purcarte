import { useEffect, useRef, useState } from "react";

export function useNearViewport(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasApproached, setHasApproached] = useState(false);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsNear(false);
      return;
    }
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setHasApproached(true);
      setIsNear(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      const near = entries.some(entry => entry.isIntersecting);
      setIsNear(near);
      if (near) setHasApproached(true);
    }, { root: element.closest("[data-home-scroll]"), rootMargin: "160px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  return { ref, hasApproached, isNear };
}
