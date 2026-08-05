import * as React from "react"
import cytoscape from "cytoscape"
import fcose from "cytoscape-fcose"
import { FolderTreeIcon, MousePointerClickIcon } from "lucide-react"

import type { VcsFileDiff } from "@/components/backlog/development/development-workspace"
import {
  buildDevelopmentGraphElements,
  type DevelopmentGraphNodeData,
} from "@/components/backlog/development/development-graph-elements"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

cytoscape.use(fcose)

const graphStyle: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": "hsl(var(--muted-foreground))",
      color: "hsl(var(--foreground))",
      height: 28,
      label: "data(label)",
      "min-zoomed-font-size": 8,
      "font-family": "var(--font-sans)",
      "font-size": 11,
      "text-max-width": 120,
      "text-overflow-wrap": "ellipsis",
      "text-valign": "center",
      "text-wrap": "ellipsis",
      width: 28,
    },
  },
  {
    selector: 'node[nodeType = "directory"]',
    style: {
      "background-color": "hsl(var(--muted))",
      "border-color": "hsl(var(--border))",
      "border-width": 1,
      "font-weight": 600,
      padding: 14,
      shape: "round-rectangle",
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": -6,
    },
  },
  {
    selector: 'node[nodeType = "file"]',
    style: {
      "border-color": "hsl(var(--background))",
      "border-width": 2,
      shape: "ellipse",
    },
  },
  {
    selector: 'node[nodeType = "file"][status = "added"]',
    style: { "background-color": "hsl(142 71% 45%)" },
  },
  {
    selector: 'node[nodeType = "file"][status = "deleted"]',
    style: { "background-color": "hsl(0 72% 51%)" },
  },
  {
    selector: 'node[nodeType = "file"][status = "modified"]',
    style: { "background-color": "hsl(38 92% 50%)" },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "hsl(var(--ring))",
      "border-width": 3,
    },
  },
]

export function DevelopmentGraph({
  diffs,
  onOpenFile,
}: {
  diffs: VcsFileDiff[]
  onOpenFile: (path: string) => void
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [selected, setSelected] = React.useState<DevelopmentGraphNodeData>()

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const graph = cytoscape({
      autoungrabify: true,
      container,
      elements: buildDevelopmentGraphElements(diffs),
      layout: {
        name: "fcose",
        animate: false,
        fit: true,
        padding: 32,
      } as cytoscape.LayoutOptions,
      minZoom: 0.45,
      style: graphStyle,
    })

    const handleTap = (event: cytoscape.EventObject) => {
      if (event.target === graph) return
      const data = event.target.data() as DevelopmentGraphNodeData
      setSelected(data)
      if (data.nodeType === "file") onOpenFile(data.path)
    }

    graph.on("tap", "node", handleTap)
    const resizeObserver = new ResizeObserver(() => graph.resize())
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      graph.removeListener("tap", "node", handleTap)
      graph.destroy()
    }
  }, [diffs, onOpenFile])

  return (
    <Card className="gap-0 py-0" size="sm">
      <CardHeader className="border-b px-3 py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FolderTreeIcon className="size-4 text-muted-foreground" />
          Change map
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative h-64 min-h-64 w-full overflow-hidden bg-muted/10">
          <div
            aria-label="Changed files map"
            className="absolute inset-0"
            ref={containerRef}
          />
          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-3 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
            <LegendDot className="bg-emerald-500" label="Added" />
            <LegendDot className="bg-amber-500" label="Modified" />
            <LegendDot className="bg-red-500" label="Deleted" />
          </div>
          <div
            className={cn(
              "pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm transition-opacity",
              selected ? "opacity-100" : "opacity-0"
            )}
          >
            <MousePointerClickIcon className="size-3" />
            {selected?.path}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-2 rounded-full", className)} />
      {label}
    </span>
  )
}
