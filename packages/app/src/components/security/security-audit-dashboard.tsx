import type {
  SecurityAudit,
  SecurityCoverageArea,
  SecurityFinding,
  SecuritySeverity,
} from "@blame/agent-runtime"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  HistoryIcon,
  ListChecksIcon,
  RotateCwIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { SeverityBadge } from "@/components/security/security-finding-drawer"

const severityOrder: SecuritySeverity[] = ["critical", "high", "medium", "low"]

export function SecurityAuditDashboard({
  audit,
  audits,
  onCreatePlan,
  onRun,
  onSelectAudit,
  onSelectFinding,
}: {
  audit: SecurityAudit
  audits: SecurityAudit[]
  onCreatePlan(): void
  onRun(): void
  onSelectAudit(auditId: string): void
  onSelectFinding(finding: SecurityFinding): void
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden px-4 pt-[calc(var(--header-height)+1rem)] pb-4 lg:px-6 lg:pt-[calc(var(--header-height)+1.5rem)] lg:pb-6">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-2xl font-semibold">Security</h2>
            <p className="text-sm text-muted-foreground">
              {revisionLabel(audit)} · audited{" "}
              {formatDate(audit.completedAt ?? audit.updatedAt)}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button
              className="flex-1 sm:flex-none"
              variant="outline"
              onClick={onCreatePlan}
            >
              <ListChecksIcon /> Create remediation plan
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={onRun}>
              <RotateCwIcon /> Run audit
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryMetric
            label="Critical"
            value={countSeverity(audit, "critical")}
            tone="critical"
          />
          <SummaryMetric
            label="High"
            value={countSeverity(audit, "high")}
            tone="high"
          />
          <SummaryMetric
            label="Medium"
            value={countSeverity(audit, "medium")}
            tone="medium"
          />
          <SummaryMetric
            label="Coverage"
            value={`${audit.coverage?.percentage ?? 0}%`}
            tone="coverage"
          />
        </div>
        <Tabs defaultValue="findings" className="min-h-0 flex-1">
          <TabsList variant="line">
            <TabsTrigger value="findings">Findings</TabsTrigger>
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent
            value="findings"
            className="min-h-0 overflow-y-auto pt-2 pb-4"
          >
            <FindingsList audit={audit} onSelect={onSelectFinding} />
          </TabsContent>
          <TabsContent
            value="coverage"
            className="min-h-0 overflow-y-auto pt-2 pb-4"
          >
            <CoverageView audit={audit} />
          </TabsContent>
          <TabsContent
            value="history"
            className="min-h-0 overflow-y-auto pt-2 pb-4"
          >
            <HistoryView
              audit={audit}
              audits={audits}
              onSelect={onSelectAudit}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function FindingsList({
  audit,
  onSelect,
}: {
  audit: SecurityAudit
  onSelect(finding: SecurityFinding): void
}) {
  if (!audit.findings.length) {
    return (
      <Card className="items-center p-8 text-center">
        <CheckCircle2Icon className="size-8 text-emerald-500" />
        <div>
          <p className="font-heading font-semibold">No validated findings</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This result applies only to the recorded revision and coverage.
          </p>
        </div>
      </Card>
    )
  }
  const findings = [...audit.findings].sort(
    (left, right) =>
      severityOrder.indexOf(left.severity) -
      severityOrder.indexOf(right.severity)
  )
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {findings.map((finding) => (
        <button
          key={finding.fingerprint}
          type="button"
          className="group flex min-h-40 min-w-0 flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"
          onClick={() => onSelect(finding)}
        >
          <span className="flex w-full items-start justify-between gap-3">
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity} />
              <span className="text-[11px] text-muted-foreground">
                {finding.confidence} confidence
              </span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="mt-3 line-clamp-2 font-heading leading-snug font-medium">
            {finding.title}
          </span>
          <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {finding.rootCause.summary}
          </span>
          <span className="mt-auto flex w-full min-w-0 items-end justify-between gap-3 pt-4">
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {finding.affectedLocations[0]?.path ?? finding.id}
            </span>
            {finding.backlogStoryId ? (
              <Badge variant="outline" className="shrink-0">
                In backlog
              </Badge>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  )
}

function CoverageView({ audit }: { audit: SecurityAudit }) {
  const coverage = audit.coverage
  if (!coverage) return null
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
      <Card className="min-w-0 gap-0 overflow-hidden py-0">
        {coverage.areas.map((area) => (
          <CoverageRow key={area.area} area={area} />
        ))}
      </Card>
      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <p className="text-sm font-medium">Repository review</p>
          <p className="mt-2 font-heading text-3xl font-semibold">
            {coverage.percentage}%
          </p>
          <p className="text-xs text-muted-foreground">
            {coverage.reviewedFiles} explicitly inspected paths ·{" "}
            {coverage.totalFiles} mapped files
          </p>
        </Card>
        {coverage.limitations.length ? (
          <Card className="p-4">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangleIcon className="size-4 text-amber-500" />{" "}
              Limitations
            </div>
            <ul className="mt-2 space-y-2 text-xs leading-relaxed break-words text-muted-foreground">
              {coverage.limitations.map((limitation) => (
                <li key={limitation}>• {limitation}</li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function CoverageRow({ area }: { area: SecurityCoverageArea }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0 md:grid-cols-[8.5rem_minmax(0,1fr)_auto] md:items-center">
      <span className="min-w-0 text-sm font-medium capitalize">
        {area.area.replace("_", " ")}
      </span>
      <span className="order-3 col-span-2 min-w-0 text-xs leading-relaxed break-words text-muted-foreground md:order-none md:col-span-1">
        {area.detail}
      </span>
      <Badge
        variant="outline"
        className={cn(
          "justify-self-end whitespace-nowrap",
          area.status === "complete" && "text-emerald-500",
          area.status === "not_scanned" && "text-muted-foreground"
        )}
      >
        {area.status.replace("_", " ")}
      </Badge>
    </div>
  )
}

function HistoryView({
  audit,
  audits,
  onSelect,
}: {
  audit: SecurityAudit
  audits: SecurityAudit[]
  onSelect(auditId: string): void
}) {
  return (
    <Card className="gap-1 overflow-hidden bg-muted/10 p-1">
      {audits.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            "flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-transparent px-4 py-3 text-left transition-colors hover:bg-muted/45 sm:flex-nowrap",
            item.id === audit.id &&
              "border-blue-500/40 bg-blue-500/10 shadow-sm ring-1 ring-blue-500/15"
          )}
          onClick={() => onSelect(item.id)}
          aria-current={item.id === audit.id ? "true" : undefined}
        >
          <HistoryIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground",
              item.id === audit.id && "text-blue-500"
            )}
          />
          <span className="text-sm sm:w-32">{formatDate(item.startedAt)}</span>
          <span className="order-3 min-w-0 basis-full truncate font-mono text-xs text-muted-foreground sm:order-none sm:flex-1 sm:basis-auto">
            {revisionLabel(item)}
          </span>
          {item.id === audit.id ? (
            <Badge className="ml-auto sm:ml-0" variant="secondary">
              Selected
            </Badge>
          ) : null}
          {item.status === "completed" ? (
            <span className="hidden text-xs text-muted-foreground md:inline">
              {countSeverity(item, "critical")} Critical ·{" "}
              {countSeverity(item, "high")} High
            </span>
          ) : (
            <Badge
              variant={item.status === "failed" ? "destructive" : "outline"}
            >
              {item.status}
            </Badge>
          )}
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </button>
      ))}
    </Card>
  )
}

function SummaryMetric({
  label,
  tone,
  value,
}: {
  label: string
  tone: "critical" | "high" | "medium" | "coverage"
  value: number | string
}) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-heading text-2xl font-semibold",
          tone === "critical" && "text-red-500",
          tone === "high" && "text-orange-500",
          tone === "medium" && "text-amber-500"
        )}
      >
        {value}
      </p>
    </Card>
  )
}

function countSeverity(audit: SecurityAudit, severity: SecuritySeverity) {
  return audit.findings.filter((finding) => finding.severity === severity)
    .length
}

function revisionLabel(audit: SecurityAudit) {
  const branch = audit.revision?.branch ?? "working tree"
  const sha = audit.revision?.commitSha?.slice(0, 7)
  return sha
    ? `${branch} · ${sha}${audit.revision?.dirty ? " + changes" : ""}`
    : branch
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}
