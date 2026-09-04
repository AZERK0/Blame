import type { SecurityAudit } from "@blame/agent-runtime"
import { ChevronDownIcon, HistoryIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type SecurityAuditHistoryProps = {
  audit: SecurityAudit
  audits: SecurityAudit[]
  onSelect(auditId: string): void
}

export function SecurityAuditHistory({
  audit,
  audits,
  onSelect,
}: SecurityAuditHistoryProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <HistoryIcon /> History <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>
          Audit history · {audits.length} runs
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={audit.id} onValueChange={onSelect}>
          {audits.map((item) => (
            <AuditHistoryItem key={item.id} audit={item} />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AuditHistoryItem({ audit }: { audit: SecurityAudit }) {
  return (
    <DropdownMenuRadioItem value={audit.id} className="items-start py-3">
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{auditDate(audit.startedAt)}</span>
          <Badge
            variant={audit.status === "failed" ? "destructive" : "outline"}
          >
            {audit.status === "completed"
              ? `${audit.findings.length} findings`
              : audit.status}
          </Badge>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {auditRevision(audit)}
        </span>
        <span className="text-xs text-muted-foreground">
          {audit.mode === "deep" ? "Deep audit" : "Standard audit"}
        </span>
      </span>
    </DropdownMenuRadioItem>
  )
}

export function auditRevision(audit: SecurityAudit) {
  const branch = audit.revision?.branch ?? "working tree"
  const sha = audit.revision?.commitSha?.slice(0, 7)
  return sha
    ? `${branch} · ${sha}${audit.revision?.dirty ? " + changes" : ""}`
    : branch
}

export function auditDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}
