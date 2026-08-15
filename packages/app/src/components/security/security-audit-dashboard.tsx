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
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-2xl font-semibold">Security</h2>
            <p className="text-sm text-muted-foreground">
              {revisionLabel(audit)} · audited{" "}
              {formatDate(audit.completedAt ?? audit.updatedAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCreatePlan}>
              <ListChecksIcon /> Create remediation plan
            </Button>
            <Button onClick={onRun}>
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
  return (
    <div className="space-y-5">
      {severityOrder.map((severity) => {
        const findings = audit.findings.filter(
          (finding) => finding.severity === severity
        )
        if (!findings.length) return null
        return (
          <section key={severity}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {severity}
            </h3>
            <div className="space-y-2">
              {findings.map((finding) => (
                <button
                  key={finding.fingerprint}
                  type="button"
                  className="group flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/35"
                  onClick={() => onSelect(finding)}
                >
                  <SeverityBadge severity={finding.severity} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {finding.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {finding.affectedLocations[0]?.path ??
                        finding.rootCause.summary}
                    </span>
                  </span>
                  {finding.backlogStoryId ? (
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      In backlog
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground capitalize">
                    {finding.confidence}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CoverageView({ audit }: { audit: SecurityAudit }) {
  const coverage = audit.coverage
  if (!coverage) return null
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="gap-0 py-0">
        {coverage.areas.map((area) => (
          <CoverageRow key={area.area} area={area} />
        ))}
      </Card>
      <div className="space-y-4">
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
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
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
    <div className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <span className="min-w-32 text-sm font-medium capitalize">
        {area.area.replace("_", " ")}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {area.detail}
      </span>
      <Badge
        variant="outline"
        className={cn(
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
    <Card className="gap-0 py-0">
      {audits.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            "flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/35",
            item.id === audit.id && "bg-muted/35"
          )}
          onClick={() => onSelect(item.id)}
        >
          <HistoryIcon className="size-4 text-muted-foreground" />
          <span className="w-32 text-sm">{formatDate(item.startedAt)}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {revisionLabel(item)}
          </span>
          {item.status === "completed" ? (
            <span className="text-xs text-muted-foreground">
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
