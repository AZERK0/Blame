"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
};

type RevealStyle = CSSProperties & {
  "--story-reveal-delay": string;
  "--story-reveal-distance": string;
};

export function ScrollReveal({
  children,
  className = "",
  delay = 0,
  distance = 28,
}: ScrollRevealProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState<boolean | null>(null);

  useEffect(() => observeReveal(elementRef.current, setIsVisible), []);

  const style: RevealStyle = {
    "--story-reveal-delay": `${delay}ms`,
    "--story-reveal-distance": `${distance}px`,
  };

  return (
    <div
      ref={elementRef}
      className={`story-reveal ${className}`}
      data-visible={isVisible ?? undefined}
      style={style}
    >
      {children}
    </div>
  );
}

function observeReveal(
  element: HTMLDivElement | null,
  setIsVisible: (isVisible: boolean) => void,
) {
  if (!element || typeof IntersectionObserver === "undefined") {
    setIsVisible(true);
    return;
  }

  setIsVisible(false);

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) {
        setIsVisible(false);
        return;
      }

      if (entry.intersectionRatio >= 0.08) setIsVisible(true);
    },
    { threshold: [0, 0.08] },
  );

  observer.observe(element);
  return () => observer.disconnect();
}
