import type { BacklogColumnId } from "@/components/backlog/data/backlog-data"
import { ModelSelector } from "@/components/model/model-selector"
import { ColumnStatusBadge } from "@/components/backlog/shared/backlog-status-badge"

export function DrawerSidebar({ status }: { status: BacklogColumnId }) {
  return (
    <aside className="border-l bg-muted/20 p-5">
      <div className="grid gap-5">
        <SidebarField label="Model assigned">
          <ModelSelector />
        </SidebarField>
        <ColumnStatusBadge status={status} />
      </div>
    </aside>
  )
}

function SidebarField({ children, label, }: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}
