import * as React from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { sanitizeSvg } from "@/lib/sanitize-html"

type MermaidRenderState = {
  bindFunctions?: (element: Element) => void
  chart: string
  error?: string
  svg?: string
}

let mermaidInitialized = false

export function MermaidDiagram({ chart }: { chart: string }) {
  const diagramId = `mermaid-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const diagramRef = React.useRef<HTMLDivElement>(null)
  const [state, setState] = React.useState<MermaidRenderState>()
  const current = state?.chart === chart ? state : undefined

  React.useEffect(() => {
    if (!chart.trim()) return
    let active = true

    import("mermaid")
      .then(async ({ default: mermaid }) => {
        if (!mermaidInitialized) {
          mermaid.initialize({
            securityLevel: "strict",
            startOnLoad: false,
            theme: "neutral",
          })
          mermaidInitialized = true
        }
        const rendered = await mermaid.render(diagramId, chart)
        if (active) {
          setState({
            bindFunctions: rendered.bindFunctions,
            chart,
            svg: rendered.svg,
          })
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setState({
          chart,
          error: error instanceof Error ? error.message : "Invalid diagram",
        })
      })

    return () => {
      active = false
    }
  }, [chart, diagramId])

  React.useEffect(() => {
    const container = diagramRef.current
    if (!container || !current?.svg) return
    container.innerHTML = sanitizeSvg(current.svg)
    current.bindFunctions?.(container)
    return () => container.replaceChildren()
  }, [current])

  if (current?.error) {
    return (
      <div className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          Diagram unavailable: {current.error}
        </p>
        <MermaidFallback code={chart} />
      </div>
    )
  }
  if (!current?.svg) {
    return <Skeleton className="h-32 w-full rounded-lg" />
  }
  return (
    <div
      aria-label="Mermaid diagram"
      className="w-full overflow-x-auto rounded-lg border bg-background p-3"
      ref={diagramRef}
    />
  )
}

function MermaidFallback({ code }: { code: string }) {
  return (
    <pre className="w-full max-w-full overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
      <code>{code}</code>
    </pre>
  )
}
