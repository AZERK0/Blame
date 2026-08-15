import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SecurityAuditStore } from "./security-audit-store.ts";

test("persists audit artifacts separately and updates finding lifecycle", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "blame-security-store-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const store = new SecurityAuditStore();
  const created = await store.create(root, {
    mode: "standard",
    projectId: "project-1",
    scope: { type: "repository" },
  });
  const finding = securityFinding();

  await store.update(root, created.id, {
    status: "completed",
    findings: [finding],
    threatModel: {
      assets: ["Projects"],
      actors: ["User"],
      trustBoundaries: ["API"],
      attackerInputs: ["id"],
      securityInvariants: ["Tenant ownership"],
    },
    coverage: {
      status: "partial",
      percentage: 70,
      reviewedFiles: 7,
      totalFiles: 10,
      excludedFiles: 1,
      areas: [],
      inspectedPaths: ["src/project.ts"],
      limitations: [],
    },
  });
  const linked = await store.updateFinding(
    root,
    created.id,
    finding.fingerprint,
    {
      backlogStoryId: "story-1",
      status: "fixing",
    },
  );

  assert.equal(linked.findings[0].backlogStoryId, "story-1");
  assert.equal(linked.findings[0].status, "fixing");
  const directory = join(root, ".blame", "security", "audits", created.id);
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  assert.equal("findings" in manifest, false);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "findings.json"), "utf8"))[0]
      .backlogStoryId,
    "story-1",
  );
});

test("marks persisted in-flight audits as interrupted", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "blame-security-interrupted-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const store = new SecurityAuditStore();
  const created = await store.create(root, {
    mode: "deep",
    scope: { type: "repository" },
  });
  await store.update(root, created.id, { status: "validation" });

  const [recovered] = await store.failInterrupted(root);

  assert.equal(recovered.status, "failed");
  assert.match(recovered.error ?? "", /interrupted/i);
});

function securityFinding() {
  return {
    id: "SEC-12345678",
    fingerprint: "1234567890abcdef",
    title: "Missing ownership check",
    status: "open" as const,
    severity: "critical" as const,
    confidence: "high" as const,
    priority: "p0" as const,
    taxonomy: { cwe: ["CWE-862"] },
    attacker: "Authenticated user",
    rootCause: { summary: "Ownership is not checked." },
    attackPath: [{ label: "User" }, { label: "Delete project" }],
    impact: "Cross-tenant deletion.",
    evidence: [{ summary: "Unscoped delete." }],
    affectedLocations: [{ path: "src/project.ts", startLine: 10 }],
    remediation: {
      summary: "Enforce ownership.",
      guidance: ["Add a regression test."],
    },
    validation: { rationale: "Reachable.", counterEvidence: [] },
  };
}
