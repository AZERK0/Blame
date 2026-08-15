import * as React from "react"
import type { SecurityFinding } from "@blame/agent-runtime"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function SecurityRemediationDialog({
  creating,
  findings,
  onCreate,
  onOpenChange,
  open,
}: {
  creating: boolean
  findings: SecurityFinding[]
  onCreate(findings: SecurityFinding[]): void
  onOpenChange(open: boolean): void
  open: boolean
}) {
  const available = findings.filter(
    (finding) => finding.status === "open" && !finding.backlogStoryId
  )
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set())
  const selectedFindings = available.filter(
    (finding) => !excluded.has(finding.fingerprint)
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setExcluded(new Set())
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create remediation plan</DialogTitle>
          <DialogDescription>
            Create actionable backlog stories with regression and revalidation
            criteria.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-1">
          {available.map((finding) => (
            <label
              key={finding.fingerprint}
              className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50"
            >
              <Checkbox
                className="mt-0.5"
                checked={!excluded.has(finding.fingerprint)}
                onCheckedChange={(checked) =>
                  setExcluded((current) =>
                    nextExclusions(
                      current,
                      finding.fingerprint,
                      checked !== true
                    )
                  )
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {finding.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {finding.affectedLocations[0]?.path ??
                    finding.rootCause.summary}
                </span>
              </span>
              <Badge variant="outline" className="uppercase">
                {finding.severity}
              </Badge>
            </label>
          ))}
          {!available.length ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              No unlinked open findings are available.
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Related-finding grouping will be added after the initial workflow is
          validated.
        </p>
        <DialogFooter>
          <Button
            disabled={creating || !selectedFindings.length}
            onClick={() => onCreate(selectedFindings)}
          >
            {creating
              ? "Creating…"
              : `Create ${selectedFindings.length} ${selectedFindings.length === 1 ? "story" : "stories"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function nextExclusions(
  current: Set<string>,
  fingerprint: string,
  excluded: boolean
) {
  const next = new Set(current)
  if (excluded) next.add(fingerprint)
  else next.delete(fingerprint)
  return next
}
