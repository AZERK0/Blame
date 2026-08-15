import type { SecurityFinding } from "@blame/agent-runtime"
import type { UserStoryDraft } from "@/components/backlog/data/backlog-data"

export function securityFindingStory(
  finding: SecurityFinding
): Omit<UserStoryDraft, "projectId"> {
  const affected = finding.affectedLocations
    .map((location) =>
      location.startLine
        ? `${location.path}:${location.startLine}`
        : location.path
    )
    .map((location) => `- ${location}`)
    .join("\n")
  const standards = [
    ...(finding.taxonomy.cwe ?? []),
    ...(finding.taxonomy.owasp ?? []),
    ...(finding.taxonomy.asvs ?? []),
  ]
  return {
    title: remediationTitle(finding.title),
    status: "backlog",
    priority: backlogPriority(finding),
    owner: "Product",
    summary: [
      "<!-- blame:security -->",
      `## Security finding · ${finding.id}`,
      "",
      finding.rootCause.summary,
      "",
      "### Impact",
      "",
      finding.impact,
      "",
      "### Affected",
      "",
      affected || "- See the linked Security Audit finding.",
      "",
      "### Acceptance criteria",
      "",
      `- ${finding.remediation.summary}`,
      ...(finding.remediation.guidance ?? []).map((item) => `- ${item}`),
      "- Add or update a regression test for the vulnerable security property.",
      `- Revalidate ${finding.id} with Security Audit before merge.`,
      ...(standards.length
        ? [
            "",
            "### Standards",
            "",
            standards.map((item) => `- ${item}`).join("\n"),
          ]
        : []),
      "",
      "### Verification",
      "",
      `Security Audit · targeted revalidation required · fingerprint ${finding.fingerprint}`,
    ].join("\n"),
  }
}

function remediationTitle(title: string) {
  return /^(prevent|enforce|restrict|remove|upgrade|validate|protect|fix)\b/i.test(
    title
  )
    ? title
    : `Fix ${title.charAt(0).toLowerCase()}${title.slice(1)}`
}

function backlogPriority(finding: SecurityFinding) {
  if (finding.severity === "critical" || finding.severity === "high")
    return "High"
  if (finding.severity === "medium") return "Medium"
  return "Low"
}

export function isSecurityStory(summary: string) {
  return summary.includes("<!-- blame:security -->")
}
