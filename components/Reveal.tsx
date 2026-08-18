"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Reveals its children once they scroll into view.
 *
 * Uses IntersectionObserver rather than a scroll listener so the work happens
 * off the main thread, and unobserves after the first trigger — content that
 * has appeared should stay appeared, not re-animate every time it passes the
 * viewport edge.
 *
 * Starts visible when the browser has no IntersectionObserver or the reader
 * asked for reduced motion, so the page is never blank for them.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.unobserve(entry.target);
          }
        }
      },
      // Fire slightly before the element reaches the fold so the motion reads
      // as the page settling rather than as a delayed pop.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? "is-shown" : ""} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
