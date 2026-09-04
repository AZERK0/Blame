import { ShieldCheckIcon } from "lucide-react"

import { FeatureStart } from "@/components/shared/feature-start"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

const auditSteps = [
  {
    title: "Map the attack surface",
    description:
      "Review your code, configuration, and entry points in the current working revision.",
  },
  {
    title: "Validate potential issues",
    description:
      "Investigate findings and prioritize them by severity, with evidence you can inspect.",
  },
  {
    title: "Plan the fixes",
    description:
      "Review the findings board and send selected fixes straight to your backlog.",
  },
]

export function SecurityEmptyState({
  error,
  onRun,
}: {
  error?: string
  onRun(): void
}) {
  return (
    <FeatureStart
      title="Security Audit"
      description="Find, validate, and prioritize security issues."
      heading="A clearer view of your project's security."
      steps={auditSteps}
      footer="Entire project · current working revision · read-only analysis"
    >
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        Start with a standard audit, or choose a deep audit for three
        independent discovery perspectives. You review the findings before
        creating remediation tasks.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={onRun} disabled={Boolean(error)}>
        <ShieldCheckIcon /> Run your first audit
      </Button>
      <p className="text-xs text-muted-foreground">
        Choose the audit mode and analysis model next.
      </p>
    </FeatureStart>
  )
}
