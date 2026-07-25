import * as React from "react"

import {
  performanceDiagnosticsProfilerEnabled,
  recordProfilerRender,
} from "@/lib/performance-diagnostics"

export function PerformanceDiagnosticsProfiler({
  children,
  id,
}: {
  children: React.ReactNode
  id: string
}) {
  if (!performanceDiagnosticsProfilerEnabled()) return children
  return (
    <React.Profiler id={id} onRender={recordProfilerRender}>
      {children}
    </React.Profiler>
  )
}
