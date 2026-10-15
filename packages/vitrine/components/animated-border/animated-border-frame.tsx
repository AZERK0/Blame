"use client";

import type { ReactNode } from "react";

import {
  type AnimatedBorderEffect,
  useAnimatedBorderEffect,
} from "./use-animated-border-effect";

export function AnimatedBorderFrame({
  children,
  className,
  effect,
}: {
  children: ReactNode;
  className?: string;
  effect: AnimatedBorderEffect;
}) {
  const ref = useAnimatedBorderEffect(effect);
  return (
    <div ref={ref} className={className} data-border-effect={effect}>
      {children}
    </div>
  );
}
