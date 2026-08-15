import type { SecurityFinding, SecuritySeverity } from "@blame/agent-runtime"
import type { ReactNode } from "react"
import {
  ArrowDownIcon,
  CheckIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export function SecurityFindingDrawer({
  finding,
  open,
  adding,
  onAddToBacklog,
  onOpenChange,
}: {
  finding?: SecurityFinding
  open: boolean
  adding: boolean
  onAddToBacklog(finding: SecurityFinding): void
  onOpenChange(open: boolean): void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(92vw,42rem)] sm:max-w-2xl">
        {finding ? (
          <>
            <SheetHeader className="border-b pr-12">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <SeverityBadge severity={finding.severity} />
                <Badge variant="outline">{finding.confidence} confidence</Badge>
                <Badge variant="outline">{finding.id}</Badge>
              </div>
              <SheetTitle className="text-xl">{finding.title}</SheetTitle>
              <SheetDescription>{finding.rootCause.summary}</SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-6 p-5">
                <FindingSection title="Attack path">
                  <div className="rounded-lg border bg-muted/25 p-3">
                    {finding.attackPath.map((step, index) => (
                      <div key={`${step.label}-${index}`}>
                        <div className="flex items-start gap-2">
                          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />
                          <div>
                            <p className="font-medium">{step.label}</p>
                            {step.location ? (
                              <LocationLabel location={step.location} />
                            ) : null}
                          </div>
                        </div>
                        {index < finding.attackPath.length - 1 ? (
                          <ArrowDownIcon className="my-1 ml-0.5 size-4 text-muted-foreground" />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </FindingSection>
                <FindingSection title="Impact">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {finding.impact}
                  </p>
                </FindingSection>
                <FindingSection title="Affected">
                  <div className="space-y-1">
                    {finding.affectedLocations.map((location) => (
                      <div
                        key={`${location.path}:${location.startLine ?? 0}`}
                        className="rounded-md border bg-muted/25 px-3 py-2 font-mono text-xs"
                      >
                        <LocationLabel location={location} />
                      </div>
                    ))}
                  </div>
                </FindingSection>
                <FindingSection title="Remediation">
                  <p className="text-sm leading-relaxed">
                    {finding.remediation.summary}
                  </p>
                  {finding.remediation.guidance?.length ? (
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {finding.remediation.guidance.map((item) => (
                        <li key={item} className="flex gap-2">
                          <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </FindingSection>
                <FindingSection title="Evidence">
                  <div className="space-y-3">
                    {finding.evidence.map((evidence, index) => (
                      <div
                        key={`${evidence.summary}-${index}`}
                        className="space-y-1.5"
                      >
                        <p className="text-sm text-muted-foreground">
                          {evidence.summary}
                        </p>
                        {evidence.location ? (
                          <LocationLabel location={evidence.location} />
                        ) : null}
                        {evidence.code ? (
                          <pre className="overflow-x-auto rounded-lg border bg-black/90 p-3 text-xs text-neutral-100">
                            <code>{evidence.code}</code>
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </FindingSection>
                <FindingSection title="Validation">
                  <p className="text-sm text-muted-foreground">
                    {finding.validation.rationale}
                  </p>
                  {finding.validation.counterEvidence.length ? (
                    <div className="mt-2 rounded-lg border bg-muted/25 p-3">
                      <p className="mb-1 text-xs font-medium">
                        Counter-evidence considered
                      </p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {finding.validation.counterEvidence.map((item) => (
                          <li key={item}>• {item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </FindingSection>
                <FindingSection title="Standards">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ...(finding.taxonomy.cwe ?? []),
                      ...(finding.taxonomy.owasp ?? []),
                      ...(finding.taxonomy.asvs ?? []),
                    ].map((standard) => (
                      <Badge key={standard} variant="outline">
                        {standard}
                      </Badge>
                    ))}
                  </div>
                </FindingSection>
              </div>
            </ScrollArea>
            <SheetFooter className="border-t bg-muted/30">
              <Button
                disabled={adding || Boolean(finding.backlogStoryId)}
                onClick={() => onAddToBacklog(finding)}
              >
                {finding.backlogStoryId ? (
                  <>
                    <ExternalLinkIcon /> Added to backlog
                  </>
                ) : (
                  <>
                    <ShieldCheckIcon /> {adding ? "Adding…" : "Add to backlog"}
                  </>
                )}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export function SeverityBadge({ severity }: { severity: SecuritySeverity }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "uppercase",
        severity === "critical" &&
          "border-red-500/30 bg-red-500/10 text-red-500",
        severity === "high" &&
          "border-orange-500/30 bg-orange-500/10 text-orange-500",
        severity === "medium" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-500",
        severity === "low" && "border-blue-500/30 bg-blue-500/10 text-blue-500"
      )}
    >
      {severity}
    </Badge>
  )
}

function FindingSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section>
      <h3 className="mb-2 font-heading text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function LocationLabel({
  location,
}: {
  location: { path: string; startLine?: number; symbol?: string }
}) {
  return (
    <p className="font-mono text-xs text-muted-foreground">
      {location.path}
      {location.startLine ? `:${location.startLine}` : ""}
      {location.symbol ? ` · ${location.symbol}` : ""}
    </p>
  )
}
