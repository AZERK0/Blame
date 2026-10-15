"use client";

// Ported from packages/app/src/hooks/use-animated-border-effect.ts. The
// border is drawn by a shared WebGL worker on an OffscreenCanvas at a capped
// frame rate, instead of a CSS conic-gradient rotating on the compositor.
import { useLayoutEffect, useRef } from "react";

type AnimatedBorderEffect = "story-progress" | "story-review";

type EffectRegistration = {
  canvas: HTMLCanvasElement;
  disconnect(): void;
  id: number;
};

type EffectInitMessage = EffectGeometry & {
  canvas: OffscreenCanvas;
  colors: [number, number, number, number][];
  durationMs: number;
  effect: AnimatedBorderEffect;
  fps: number;
  id: number;
  type: "init";
};

type EffectGeometry = {
  active: boolean;
  borderRadius: number;
  devicePixelRatio: number;
  height: number;
  inset: number;
  width: number;
};

type EffectWorkerMessage =
  | EffectInitMessage
  | { id: number; type: "remove" }
  | ({ id: number; type: "update" } & Partial<EffectGeometry>);

const effectSettings: Record<
  AnimatedBorderEffect,
  { durationMs: number; fps: number; inset: number; maximumPixelRatio: number }
> = {
  "story-progress": {
    durationMs: 2_600,
    fps: 20,
    inset: 8,
    maximumPixelRatio: 1,
  },
  "story-review": {
    durationMs: 2_800,
    fps: 15,
    inset: 14,
    maximumPixelRatio: 1,
  },
};

let colorContext: CanvasRenderingContext2D | null | undefined;
let effectWorker: Worker | null | undefined;
let effectWorkerReady = false;
const pendingEffectMessages: [EffectWorkerMessage, Transferable[]][] = [];
let nextEffectId = 0;

/**
 * `scale` maps the element back to desktop-app pixels when it is drawn smaller
 * than in the app (a mockup), so the stroke and glow shrink with it.
 */
type EffectScale = (element: HTMLElement) => number;

export function useAnimatedBorderEffect<T extends HTMLElement = HTMLDivElement>(
  effect: AnimatedBorderEffect | undefined,
  scale?: EffectScale,
) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!effect || !element || !effectsSupported() || reducedMotionPreferred())
      return;
    const registration = registerEffect(element, effect, scale);
    return registration?.disconnect;
  }, [effect, scale]);

  return ref;
}

function registerEffect(
  element: HTMLElement,
  effect: AnimatedBorderEffect,
  scale: EffectScale = () => 1,
): EffectRegistration | undefined {
  if (!animatedBorderWorker()) return undefined;
  const id = ++nextEffectId;
  const canvas = document.createElement("canvas");
  const settings = effectSettings[effect];
  const offscreen = canvas.transferControlToOffscreen();
  let intersecting = false;

  canvas.className = "animated-border-effect-canvas";
  canvas.setAttribute("aria-hidden", "true");
  // Inline so the canvas never joins the layout flow: in flow it would grow
  // its host, which the ResizeObserver below would feed back into the canvas.
  Object.assign(canvas.style, {
    position: "absolute",
    zIndex: "0",
    pointerEvents: "none",
  });
  element.append(canvas);

  const geometry = () => {
    const next = effectGeometry(
      element,
      settings.inset,
      settings.maximumPixelRatio,
      scale(element),
      intersecting,
    );
    Object.assign(canvas.style, {
      inset: `${-next.inset}px`,
      width: `calc(100% + ${next.inset * 2}px)`,
      height: `calc(100% + ${next.inset * 2}px)`,
    });
    return next;
  };
  postEffectMessage(
    {
      ...geometry(),
      canvas: offscreen,
      colors: effectColors(effect),
      durationMs: settings.durationMs,
      effect,
      fps: settings.fps,
      id,
      type: "init",
    },
    [offscreen],
  );

  const resizeObserver = new ResizeObserver(() => {
    postEffectMessage({ ...geometry(), id, type: "update" });
  });
  resizeObserver.observe(element);

  // The landing page moves these elements with 3D transforms and opacity, so
  // `trackVisibility` (used by the desktop app) would report them as hidden.
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    intersecting = Boolean(entry?.isIntersecting);
    postEffectMessage({
      active: effectActive(intersecting),
      id,
      type: "update",
    });
  });
  intersectionObserver.observe(element);

  const handleVisibility = () => {
    postEffectMessage({
      active: effectActive(intersecting),
      id,
      type: "update",
    });
  };
  document.addEventListener("visibilitychange", handleVisibility);

  return {
    canvas,
    id,
    disconnect() {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      postEffectMessage({ id, type: "remove" });
      canvas.remove();
    },
  };
}

function animatedBorderWorker() {
  if (effectWorker !== undefined) return effectWorker;
  try {
    // Classic worker: Turbopack bootstraps workers with importScripts().
    effectWorker = new Worker(
      new URL("./animated-border-effect.worker.ts", import.meta.url),
    );
    // The bundler loads the worker's chunks asynchronously, so messages sent
    // before its handler is installed would be dropped: wait for "ready".
    effectWorker.onmessage = ({ data }: MessageEvent<{ type?: string }>) => {
      if (data?.type !== "ready" || effectWorkerReady) return;
      effectWorkerReady = true;
      for (const [message, transfer] of pendingEffectMessages.splice(0)) {
        effectWorker?.postMessage(message, transfer);
      }
    };
  } catch {
    effectWorker = null;
  }
  return effectWorker;
}

function postEffectMessage(
  message: EffectWorkerMessage,
  transfer: Transferable[] = [],
) {
  if (!effectWorker) return;
  if (effectWorkerReady) effectWorker.postMessage(message, transfer);
  else pendingEffectMessages.push([message, transfer]);
}

function effectGeometry(
  element: HTMLElement,
  inset: number,
  maximumPixelRatio: number,
  scale: number,
  intersecting: boolean,
): EffectGeometry {
  // The shader works in surface pixels: rendering at `scale` times the CSS
  // size keeps its stroke and glow at desktop-app proportions.
  return {
    active: effectActive(intersecting),
    borderRadius: numericBorderRadius(element),
    devicePixelRatio:
      Math.min(window.devicePixelRatio || 1, maximumPixelRatio) * scale,
    // Layout size, not getBoundingClientRect(): the hero mockup is scaled and
    // rotated in 3D while it scrolls, and the canvas lives in that same space.
    height: element.offsetHeight,
    inset: inset / scale,
    width: element.offsetWidth,
  };
}

function effectActive(intersecting: boolean) {
  return intersecting && document.visibilityState === "visible";
}

function numericBorderRadius(element: HTMLElement) {
  return Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
}

function effectColors(effect: AnimatedBorderEffect) {
  if (effect === "story-progress") {
    return [
      resolveColor("oklch(0.65 0.22 255)"),
      resolveColor("oklch(0.85 0.12 235 / 75%)"),
    ];
  }
  return [
    resolveColor("oklch(0.8 0.16 240 / 70%)"),
    resolveColor("oklch(0.7 0.21 245 / 70%)"),
    resolveColor("oklch(0.62 0.22 255 / 55%)"),
  ];
}

function resolveColor(value: string) {
  colorContext ??= document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  const context = colorContext;
  if (!context) return [0.2, 0.55, 1, 1] as [number, number, number, number];
  context.canvas.width = 1;
  context.canvas.height = 1;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "transparent";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(
    0,
    0,
    1,
    1,
  ).data;
  return [red / 255, green / 255, blue / 255, alpha / 255] as [
    number,
    number,
    number,
    number,
  ];
}

function effectsSupported() {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype
  );
}

function reducedMotionPreferred() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type { AnimatedBorderEffect };
