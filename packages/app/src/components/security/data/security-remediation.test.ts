import assert from "node:assert/strict"
import test from "node:test"

import {
  isSecurityStory,
  securityFindingStory,
} from "./security-remediation.ts"

test("creates an actionable security remediation story", () => {
  const story = securityFindingStory({
    id: "SEC-ABC12345",
    fingerprint: "abc12345",
    title: "Missing project ownership check",
    status: "open",
    severity: "critical",
    confidence: "high",
    priority: "p0",
    taxonomy: { cwe: ["CWE-862"], owasp: ["A01:2025"] },
    attacker: "Authenticated user",
    rootCause: { summary: "Deletion is not scoped to the tenant." },
    attackPath: [{ label: "User" }, { label: "Delete" }],
    impact: "Cross-tenant project deletion.",
    evidence: [{ summary: "Unscoped database delete." }],
    affectedLocations: [{ path: "src/projects.ts", startLine: 84 }],
    remediation: {
      summary: "Enforce tenant ownership before deletion.",
      guidance: ["Centralize the authorization check."],
    },
    validation: { rationale: "The route is reachable.", counterEvidence: [] },
  })

  assert.equal(story.priority, "High")
  assert.equal(story.status, "backlog")
  assert.ok(isSecurityStory(story.summary))
  assert.match(story.summary, /targeted revalidation required/)
  assert.match(story.summary, /src\/projects\.ts:84/)
  assert.match(story.summary, /CWE-862/)
})
