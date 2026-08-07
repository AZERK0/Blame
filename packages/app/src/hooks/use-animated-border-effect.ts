import * as React from "react"

type AnimatedBorderEffect = "agent-response" | "story-progress" | "story-review"

type EffectRegistration = {
  canvas: HTMLCanvasElement
  disconnect(): void
  id: number
}

type EffectInitMessage = EffectGeometry & {
  canvas: OffscreenCanvas
  colors: [number, number, number, number][]
  durationMs: number
  effect: AnimatedBorderEffect
  fps: number
  id: number
  type: "init"
}

type EffectGeometry = {
  active: boolean
  borderRadius: number
  devicePixelRatio: number
  height: number
  inset: number
  width: number
}

type EffectWorkerMessage =
  | EffectInitMessage
  | { id: number; type: "remove" }
  | ({ id: number; type: "update" } & Partial<EffectGeometry>)

const effectSettings: Record<
  AnimatedBorderEffect,
  { durationMs: number; fps: number; inset: number; maximumPixelRatio: number }
> = {
  "agent-response": {
    durationMs: 5_000,
    fps: 30,
    inset: 8,
    maximumPixelRatio: 1,
  },
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
}

let colorContext: CanvasRenderingContext2D | null | undefined
let effectWorker: Worker | undefined
let nextEffectId = 0

export function useAnimatedBorderEffect(
  effect: AnimatedBorderEffect | undefined,
  color?: string
) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!effect || !element || reducedMotionPreferred()) return
    const registration = registerEffect(element, effect, color)
    return registration.disconnect
  }, [color, effect])

  return ref
}

function registerEffect(
  element: HTMLDivElement,
  effect: AnimatedBorderEffect,
  color?: string
): EffectRegistration {
  const worker = animatedBorderWorker()
  const id = ++nextEffectId
  const canvas = document.createElement("canvas")
  const settings = effectSettings[effect]
  const offscreen = canvas.transferControlToOffscreen()
  let intersecting = true

  canvas.className = "animated-border-effect-canvas"
  canvas.setAttribute("aria-hidden", "true")
  if (settings.inset) {
    canvas.style.inset = `${-settings.inset}px`
    canvas.style.width = `calc(100% + ${settings.inset * 2}px)`
    canvas.style.height = `calc(100% + ${settings.inset * 2}px)`
  }
  element.append(canvas)

  const geometry = () =>
    effectGeometry(
      element,
      settings.inset,
      settings.maximumPixelRatio,
      intersecting
    )
  worker.postMessage(
    {
      ...geometry(),
      canvas: offscreen,
      colors: effectColors(element, effect, color),
      durationMs: settings.durationMs,
      effect,
      fps: settings.fps,
      id,
      type: "init",
    } satisfies EffectInitMessage,
    [offscreen]
  )

  const resizeObserver = new ResizeObserver(() => {
    postEffectMessage({ ...geometry(), id, type: "update" })
  })
  resizeObserver.observe(element)

  const tracksVisibility =
    effect !== "agent-response" &&
    "isVisible" in IntersectionObserverEntry.prototype
  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      const visible = (
        entry as IntersectionObserverEntry & { isVisible?: boolean }
      )?.isVisible
      intersecting = Boolean(
        entry?.isIntersecting && (!tracksVisibility || visible)
      )
      postEffectMessage({
        active: effectActive(intersecting),
        id,
        type: "update",
      })
    },
    tracksVisibility
      ? ({ delay: 100, trackVisibility: true } as IntersectionObserverInit)
      : undefined
  )
  intersectionObserver.observe(element)

  const handleVisibility = () => {
    postEffectMessage({
      active: effectActive(intersecting),
      id,
      type: "update",
    })
  }
  document.addEventListener("visibilitychange", handleVisibility)

  return {
    canvas,
    id,
    disconnect() {
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener("visibilitychange", handleVisibility)
      postEffectMessage({ id, type: "remove" })
      canvas.remove()
    },
  }
}

function animatedBorderWorker() {
  effectWorker ??= new Worker(
    new URL("./animated-border-effect.worker.ts", import.meta.url),
    { type: "module" }
  )
  return effectWorker
}

function postEffectMessage(message: EffectWorkerMessage) {
  effectWorker?.postMessage(message)
}

function effectGeometry(
  element: HTMLElement,
  inset: number,
  maximumPixelRatio: number,
  intersecting: boolean
): EffectGeometry {
  const { height, width } = element.getBoundingClientRect()
  return {
    active: effectActive(intersecting),
    borderRadius: numericBorderRadius(element),
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, maximumPixelRatio),
    height,
    inset,
    width,
  }
}

function effectActive(intersecting: boolean) {
  return intersecting && document.visibilityState === "visible"
}

function numericBorderRadius(element: HTMLElement) {
  return Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
}

function effectColors(
  element: HTMLElement,
  effect: AnimatedBorderEffect,
  color?: string
) {
  if (effect === "agent-response") {
    const customColor = (
      color ??
      getComputedStyle(element).getPropertyValue("--agent-response-color")
    ).trim()
    if (customColor) {
      const resolved = resolveColor(customColor)
      return [resolved, resolved, resolved]
    }
    return [
      resolveColor("oklch(0.72 0.2 285)"),
      resolveColor("oklch(0.78 0.16 230)"),
      resolveColor("oklch(0.62 0.22 255)"),
    ]
  }
  if (effect === "story-progress") {
    return [
      resolveColor("oklch(0.65 0.22 255)"),
      resolveColor("oklch(0.85 0.12 235 / 75%)"),
    ]
  }
  return [
    resolveColor("oklch(0.8 0.16 240 / 70%)"),
    resolveColor("oklch(0.7 0.21 245 / 70%)"),
    resolveColor("oklch(0.62 0.22 255 / 55%)"),
  ]
}

function resolveColor(value: string, fallback?: string) {
  colorContext ??= document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  })
  const context = colorContext
  if (!context) return [0.2, 0.55, 1, 1] as [number, number, number, number]
  context.canvas.width = 1
  context.canvas.height = 1
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = fallback ?? "transparent"
  try {
    context.fillStyle = value.trim() || fallback || "transparent"
  } catch {
    context.fillStyle = fallback ?? "transparent"
  }
  context.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(
    0,
    0,
    1,
    1
  ).data
  return [red / 255, green / 255, blue / 255, alpha / 255] as [
    number,
    number,
    number,
    number,
  ]
}

function reducedMotionPreferred() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export type { AnimatedBorderEffect }
