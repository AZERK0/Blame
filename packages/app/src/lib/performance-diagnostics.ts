import type { ProfilerOnRenderCallback } from "react"

type DiagnosticMetric = {
  count: number
  maximum: number
  total: number
}

type DiagnosticEvent = {
  attributes?: Record<string, number | string>
  name: string
  timestamp: string
}

type DiagnosticSnapshot = {
  events: DiagnosticEvent[]
  metrics: Record<string, DiagnosticMetric>
  startedAt: string
  stoppedAt: string
}

type PerformanceDiagnosticsApi = {
  report: () => string
  reset: () => void
}

type DiagnosticsWindow = Window & {
  __blamePerformanceDiagnostics?: PerformanceDiagnosticsApi
}

const diagnosticsStorageKey = "blame:performance-diagnostics:v1"
const diagnosticsProfilerStorageKey = "blame:performance-profiler:v1"
const snapshotIntervalMs = 5_000
const eventLoopSampleIntervalMs = 100
const maximumSnapshots = 360
const maximumEventsPerSnapshot = 100
let diagnostics: PerformanceDiagnostics | undefined
let installed = false

class PerformanceDiagnostics {
  private events: DiagnosticEvent[] = []
  private metrics = new Map<string, DiagnosticMetric>()
  private snapshots: DiagnosticSnapshot[] = []
  private startedAt = new Date().toISOString()

  record(name: string, value: number) {
    if (!Number.isFinite(value)) return
    const current = this.metrics.get(name) ?? {
      count: 0,
      maximum: Number.NEGATIVE_INFINITY,
      total: 0,
    }
    current.count += 1
    current.maximum = Math.max(current.maximum, value)
    current.total += value
    this.metrics.set(name, current)
  }

  event(name: string, attributes?: Record<string, number | string>) {
    if (this.events.length >= maximumEventsPerSnapshot) return
    this.events.push({
      attributes,
      name,
      timestamp: new Date().toISOString(),
    })
  }

  snapshot() {
    const snapshot = this.currentSnapshot()
    this.snapshots.push(snapshot)
    this.snapshots = this.snapshots.slice(-maximumSnapshots)
    this.events = []
    this.metrics.clear()
    this.startedAt = snapshot.stoppedAt
  }

  report() {
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      snapshots: [...this.snapshots, this.currentSnapshot()],
      version: 1,
    })
  }

  reset() {
    this.events = []
    this.metrics.clear()
    this.snapshots = []
    this.startedAt = new Date().toISOString()
  }

  private currentSnapshot(): DiagnosticSnapshot {
    return {
      events: [...this.events],
      metrics: Object.fromEntries(this.metrics),
      startedAt: this.startedAt,
      stoppedAt: new Date().toISOString(),
    }
  }
}

export function installPerformanceDiagnostics() {
  if (installed || !performanceDiagnosticsRequested()) return
  installed = true
  diagnostics = new PerformanceDiagnostics()
  exposePerformanceDiagnostics(diagnostics)
  installEventLoopSampler()
  installPerformanceObservers()
  window.setInterval(() => diagnostics?.snapshot(), snapshotIntervalMs)
}

export function recordPerformanceCount(name: string, count = 1) {
  diagnostics?.record(name, count)
}

export function recordPerformanceMetric(name: string, value: number) {
  diagnostics?.record(name, value)
}

export function recordPerformanceEvent(
  name: string,
  attributes?: Record<string, number | string>
) {
  diagnostics?.event(name, attributes)
}

export async function measurePerformanceOperation<T>(
  name: string,
  operation: () => Promise<T>
) {
  if (!diagnostics) return operation()
  const startedAt = performance.now()
  try {
    return await operation()
  } catch (error) {
    recordPerformanceCount(`${name}.failure`)
    throw error
  } finally {
    recordPerformanceMetric(
      `${name}.duration_ms`,
      performance.now() - startedAt
    )
  }
}

export function performanceDiagnosticsEnabled() {
  return Boolean(diagnostics)
}

export function performanceDiagnosticsProfilerEnabled() {
  if (!diagnostics) return false
  try {
    const query = new URLSearchParams(window.location.search)
    return (
      window.localStorage.getItem(diagnosticsProfilerStorageKey) === "true" ||
      query.get("performanceProfiler") === "true"
    )
  } catch {
    return false
  }
}

export const recordProfilerRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration
) => {
  recordPerformanceMetric(`react.${id}.actual_duration_ms`, actualDuration)
  recordPerformanceMetric(`react.${id}.base_duration_ms`, baseDuration)
  recordPerformanceCount(`react.${id}.render.${phase}`)
  if (actualDuration < 16) return
  recordPerformanceEvent("react.slow_render", {
    durationMs: Math.round(actualDuration),
    id,
    phase,
  })
}

function performanceDiagnosticsRequested() {
  try {
    const query = new URLSearchParams(window.location.search)
    return (
      window.localStorage.getItem(diagnosticsStorageKey) === "true" ||
      query.get("performanceDiagnostics") === "true"
    )
  } catch {
    return false
  }
}

function exposePerformanceDiagnostics(state: PerformanceDiagnostics) {
  const diagnosticsWindow = window as DiagnosticsWindow
  diagnosticsWindow.__blamePerformanceDiagnostics = {
    report: () => state.report(),
    reset: () => state.reset(),
  }
}

function installEventLoopSampler() {
  let expectedAt = performance.now() + eventLoopSampleIntervalMs
  window.setInterval(() => {
    const now = performance.now()
    recordPerformanceMetric(
      "renderer.event_loop_delay_ms",
      Math.max(0, now - expectedAt)
    )
    expectedAt = now + eventLoopSampleIntervalMs
  }, eventLoopSampleIntervalMs)
}

function installPerformanceObservers() {
  installPerformanceObserver("longtask", observeLongTasks)
  installPerformanceObserver("event", observeInputEvents, {
    durationThreshold: 16,
  })
}

function installPerformanceObserver(
  type: string,
  callback: PerformanceObserverCallback,
  options: Record<string, number> = {}
) {
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) return
  const observer = new PerformanceObserver(callback)
  observer.observe({ buffered: true, type, ...options })
}

function observeLongTasks(entries: PerformanceObserverEntryList) {
  entries.getEntries().forEach((entry) => {
    recordPerformanceMetric("renderer.long_task_ms", entry.duration)
    recordPerformanceEvent("renderer.long_task", {
      durationMs: Math.round(entry.duration),
    })
  })
}

function observeInputEvents(entries: PerformanceObserverEntryList) {
  entries.getEntries().forEach((entry) => {
    if (!keyboardEventEntry(entry)) return
    const timing = entry as PerformanceEventTiming
    recordPerformanceMetric(
      "renderer.keyboard_input_delay_ms",
      Math.max(0, timing.processingStart - timing.startTime)
    )
    recordPerformanceMetric(
      "renderer.keyboard_event_duration_ms",
      timing.duration
    )
  })
}

function keyboardEventEntry(entry: PerformanceEntry) {
  return ["beforeinput", "input", "keydown", "keyup"].includes(entry.name)
}
