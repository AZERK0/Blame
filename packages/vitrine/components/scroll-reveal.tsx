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

type VisibilitySetter = (isVisible: boolean) => void;

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
  setIsVisible: VisibilitySetter,
) {
  if (!element || typeof IntersectionObserver === "undefined") {
    setIsVisible(true);
    return;
  }

  setIsVisible(false);

  const activationObserver = createActivationObserver(setIsVisible);
  const viewportExitObserver = createViewportExitObserver(setIsVisible);

  activationObserver.observe(element);
  viewportExitObserver.observe(element);

  return () => {
    activationObserver.disconnect();
    viewportExitObserver.disconnect();
  };
}

function createActivationObserver(setIsVisible: VisibilitySetter) {
  return new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        setIsVisible(true);
        return;
      }

      if (entry && entry.boundingClientRect.bottom <= 0) {
        setIsVisible(false);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0 },
  );
}

function createViewportExitObserver(setIsVisible: VisibilitySetter) {
  return new IntersectionObserver(([entry]) => {
    if (
      entry &&
      !entry.isIntersecting &&
      entry.rootBounds &&
      entry.boundingClientRect.top >= entry.rootBounds.bottom
    ) {
      setIsVisible(false);
    }
  });
}
