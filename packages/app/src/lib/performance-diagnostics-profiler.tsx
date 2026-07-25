import * as React from "react"

import {
  performanceDiagnosticsEnabled,
  recordProfilerRender,
} from "@/lib/performance-diagnostics"

export function PerformanceDiagnosticsProfiler({
  children,
  id,
}: {
  children: React.ReactNode
  id: string
}) {
  if (!performanceDiagnosticsEnabled()) return children
  return (
    <React.Profiler id={id} onRender={recordProfilerRender}>
      {children}
    </React.Profiler>
  )
}
