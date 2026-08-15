import type {
  DiscoverSecurityAuditInput,
  MapSecurityAuditResult,
  RunSecurityAuditInput,
  SecurityAudit,
  SecurityAuditDiscoveryResult,
  SecurityAuditFindingHistory,
  SecurityAuditProgressStep,
  ValidateSecurityAuditInput,
  ValidateSecurityAuditResult,
} from "@blame/agent-runtime";
import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

type SecurityAuditIpcDependencies = {
  resolveInput(input: RunSecurityAuditInput): Promise<RunSecurityAuditInput>;
  map(input: RunSecurityAuditInput): Promise<MapSecurityAuditResult>;
  discover(
    input: DiscoverSecurityAuditInput,
  ): Promise<SecurityAuditDiscoveryResult>;
  validate(
    input: ValidateSecurityAuditInput,
  ): Promise<ValidateSecurityAuditResult>;
  cancel(auditId: string): Promise<unknown>;
  finish(auditId: string): Promise<unknown>;
};

type ActiveAudit = {
  audit: SecurityAudit;
  cancelled: boolean;
  root: string;
  sender: WebContents;
};

const activeAudits = new Map<string, ActiveAudit>();

export function registerSecurityAuditIpcHandlers(
  dependencies: SecurityAuditIpcDependencies,
) {
  ipcMain.handle("security-audits:active", (_event, value) => {
    const active = activeAudits.get(securityAuditRoot(value));
    return active?.audit;
  });
  ipcMain.handle("security-audits:run", (event, value) =>
    runSecurityAudit(
      event.sender,
      securityAuditRunRequest(value),
      dependencies,
    ),
  );
  ipcMain.handle("security-audits:cancel", async (_event, value) => {
    const request = securityAuditRequest(value);
    const active = activeAudits.get(request.root);
    if (!active || active.audit.id !== request.auditId) return undefined;
    if (active.cancelled) return active.audit;
    active.cancelled = true;
    await dependencies.cancel(active.audit.id);
    if (active.audit.status !== "cancelled") {
      updateAudit(active, {
        status: "cancelled",
        error: "Audit stopped by user.",
        completedAt: new Date().toISOString(),
        progress: {
          phase: active.audit.progress?.phase ?? "queued",
          steps: (active.audit.progress?.steps ?? []).map((step) =>
            step.status === "running"
              ? { ...step, status: "cancelled" as const }
              : step,
          ),
        },
      });
    }
    return active.audit;
  });
}

async function runSecurityAudit(
  sender: WebContents,
  input: RunSecurityAuditInput,
  dependencies: SecurityAuditIpcDependencies,
) {
  const root = securityAuditRoot(input);
  if (activeAudits.has(root)) {
    throw new Error("A security audit is already running for this project");
  }
  const active: ActiveAudit = {
    audit: createAudit(input),
    cancelled: false,
    root,
    sender,
  };
  activeAudits.set(root, active);
  emitChanged(active);
  try {
    updateAudit(active, {
      status: "mapping",
      progress: {
        phase: "mapping",
        steps: mappingSteps("running"),
      },
    });
    const resolvedInput = await dependencies.resolveInput(input);
    const { previousFindings: _previousFindings, ...resolved } = resolvedInput;
    assertAuditActive(active);
    const repository = await dependencies.map(resolved);
    assertAuditActive(active);
    updateAudit(active, {
      revision: repository.revision,
      surfaceMap: repository.surfaceMap,
      progress: {
        phase: "mapping",
        steps: mappingSteps("completed", repository),
      },
    });

    const auditPerspectives = perspectives(input.mode);
    updateAudit(active, {
      status: "discovery",
      progress: {
        phase: "discovery",
        steps: discoverySteps(auditPerspectives),
      },
    });
    const runs = await Promise.allSettled(
      auditPerspectives.map(async (perspective) => {
        const result = await dependencies.discover({
          ...resolved,
          auditId: active.audit.id,
          perspective,
          repository,
        });
        assertAuditActive(active);
        completeProgressStep(
          active,
          `discovery:${perspective}`,
          `${result.candidates.length} candidate${result.candidates.length === 1 ? "" : "s"} reported`,
        );
        return result;
      }),
    );
    assertAuditActive(active);
    const agentDiscoveries = runs.map((run) => {
      if (run.status === "rejected") throw run.reason;
      return run.value;
    });
    const discoveries: SecurityAuditDiscoveryResult[] = [
      deterministicDiscovery(repository),
      ...agentDiscoveries,
    ];
    const candidateCount = discoveries.reduce(
      (count, discovery) => count + discovery.candidates.length,
      0,
    );
    updateAudit(active, {
      status: "validation",
      candidateCount,
      sessionIds: agentDiscoveries.map(({ sessionId }) => sessionId),
      progress: {
        phase: "validation",
        steps: [
          progressStep(
            "validation:merge",
            "Merging duplicate candidates",
            "completed",
            `${candidateCount} candidate${candidateCount === 1 ? "" : "s"} to validate`,
          ),
          progressStep(
            "validation:evidence",
            "Tracing reachability, controls and counter-evidence",
            "running",
          ),
          progressStep(
            "validation:coverage",
            "Calculating coverage and confidence",
            "pending",
          ),
        ],
      },
    });
    const validation = await dependencies.validate({
      ...resolved,
      auditId: active.audit.id,
      repository,
      discoveries,
    });
    assertAuditActive(active);
    updateAudit(active, {
      progress: {
        phase: "validation",
        steps: [
          progressStep(
            "validation:merge",
            "Merging duplicate candidates",
            "completed",
          ),
          progressStep(
            "validation:evidence",
            "Tracing reachability, controls and counter-evidence",
            "completed",
            `${validation.findings.length} validated finding${validation.findings.length === 1 ? "" : "s"}`,
          ),
          progressStep(
            "validation:coverage",
            "Calculating coverage and confidence",
            "completed",
            `${validation.coverage.percentage}% repository review`,
          ),
        ],
      },
    });
    updateAudit(active, {
      status: "prioritization",
      sessionIds: [...active.audit.sessionIds, validation.sessionId],
      progress: {
        phase: "prioritization",
        steps: [
          progressStep(
            "prioritization:fingerprints",
            "Reconciling fingerprints with audit history",
            "running",
          ),
          progressStep(
            "prioritization:report",
            "Preparing the final report",
            "pending",
          ),
        ],
      },
    });
    const findings = reconcileFindings(
      active.audit.id,
      validation.findings,
      input.previousFindings ?? [],
    );
    assertAuditActive(active);
    updateAudit(active, {
      progress: {
        phase: "prioritization",
        steps: [
          progressStep(
            "prioritization:fingerprints",
            "Reconciling fingerprints with audit history",
            "completed",
          ),
          progressStep(
            "prioritization:report",
            "Preparing the final report",
            "completed",
          ),
        ],
      },
    });
    return updateAudit(active, {
      status: "completed",
      threatModel: validation.threatModel,
      coverage: validation.coverage,
      findings,
      candidateCount: validation.candidateCount,
      rejectedCandidateCount: validation.rejectedCandidateCount,
      completedAt: new Date().toISOString(),
      progress: {
        phase: "completed",
        steps: [
          progressStep("report:ready", "Security report ready", "completed"),
        ],
      },
    });
  } catch (error) {
    if (active.cancelled) return active.audit;
    const message =
      error instanceof Error ? error.message : "Security audit failed";
    updateAudit(active, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
      progress: active.audit.progress
        ? {
            ...active.audit.progress,
            steps: active.audit.progress.steps.map((step) =>
              step.status === "running"
                ? { ...step, status: "failed" as const }
                : step,
            ),
          }
        : undefined,
    });
    throw Object.assign(new Error(message), { audit: active.audit });
  } finally {
    activeAudits.delete(root);
    await dependencies.finish(active.audit.id);
  }
}

function createAudit(input: RunSecurityAuditInput): SecurityAudit {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    id: randomUUID(),
    sequence: 0,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    analysisModel: {
      providerId: input.providerId,
      modelId: input.modelId,
      ...(input.reasoningEffort
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
    },
    mode: input.mode,
    scope: input.scope ?? { type: "repository" },
    status: "queued",
    findings: [],
    candidateCount: 0,
    rejectedCandidateCount: 0,
    sessionIds: [],
    scannerVersions: {
      "blame-security-engine": "1",
      "ai-static-review": "1",
      "local-secret-scanner": "1",
      "threat-model": "1",
    },
    progress: {
      phase: "queued",
      steps: [
        progressStep(
          "queued:runtime",
          "Preparing the local audit runtime",
          "running",
        ),
      ],
    },
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

function reconcileFindings(
  auditId: string,
  findings: SecurityAudit["findings"],
  history: SecurityAuditFindingHistory[],
) {
  const previousByFingerprint = new Map<string, SecurityAuditFindingHistory>();
  for (const previous of history) {
    if (!previousByFingerprint.has(previous.fingerprint)) {
      previousByFingerprint.set(previous.fingerprint, previous);
    }
  }
  return findings.map((finding) => {
    const previous = previousByFingerprint.get(finding.fingerprint);
    return {
      ...finding,
      status:
        previous?.status === "fixed"
          ? ("regressed" as const)
          : (previous?.status ?? finding.status),
      ...(previous?.backlogStoryId
        ? { backlogStoryId: previous.backlogStoryId }
        : {}),
      firstSeenAuditId:
        previous?.firstSeenAuditId ?? previous?.auditId ?? auditId,
      lastSeenAuditId: auditId,
    };
  });
}

function deterministicDiscovery(
  repository: MapSecurityAuditResult,
): SecurityAuditDiscoveryResult {
  return {
    sessionId: "scanner:deterministic",
    threatModel: {
      assets: [],
      actors: [],
      trustBoundaries: [],
      attackerInputs: [],
      securityInvariants: [],
    },
    candidates: repository.deterministic.candidates,
    inspectedPaths: repository.deterministic.inspectedPaths,
    limitations: repository.deterministic.limitations,
  };
}

function perspectives(mode: RunSecurityAuditInput["mode"]) {
  return mode === "deep"
    ? ([
        "forward_data_flow",
        "backward_sensitive_operations",
        "business_logic",
      ] as const)
    : (["baseline"] as const);
}

function mappingSteps(
  status: "running" | "completed",
  repository?: MapSecurityAuditResult,
): SecurityAuditProgressStep[] {
  return [
    progressStep(
      "mapping:inventory",
      "Indexing repository files and revision",
      status,
      repository
        ? `${repository.surfaceMap.fileCount} files mapped`
        : undefined,
    ),
    progressStep(
      "mapping:surface",
      "Detecting services, entrypoints and sensitive paths",
      status === "running" ? "pending" : "completed",
      repository
        ? `${repository.surfaceMap.services.length} services · ${repository.surfaceMap.entrypoints.length} entrypoints`
        : undefined,
    ),
    progressStep(
      "mapping:secrets",
      "Scanning current files for exposed secrets",
      status === "running" ? "pending" : "completed",
      repository
        ? `${repository.deterministic.inspectedPaths.length} paths inspected by deterministic scanners`
        : undefined,
    ),
  ];
}

function discoverySteps(
  auditPerspectives: ReturnType<typeof perspectives>,
): SecurityAuditProgressStep[] {
  return [
    progressStep(
      "discovery:deterministic",
      "Reviewing deterministic scanner candidates",
      "completed",
    ),
    ...auditPerspectives.map((perspective) =>
      progressStep(
        `discovery:${perspective}`,
        perspectiveLabel(perspective),
        "running",
      ),
    ),
  ];
}

function perspectiveLabel(
  perspective: ReturnType<typeof perspectives>[number],
) {
  if (perspective === "forward_data_flow")
    return "Tracing untrusted inputs to sensitive operations";
  if (perspective === "backward_sensitive_operations")
    return "Tracing sensitive operations back to callers";
  if (perspective === "business_logic")
    return "Reviewing authorization and business invariants";
  return "Reviewing attack paths across the project";
}

function completeProgressStep(
  active: ActiveAudit,
  stepId: string,
  detail?: string,
) {
  const progress = active.audit.progress;
  if (!progress) return;
  updateAudit(active, {
    progress: {
      ...progress,
      steps: progress.steps.map((step) =>
        step.id === stepId
          ? { ...step, status: "completed" as const, detail }
          : step,
      ),
    },
  });
}

function progressStep(
  id: string,
  label: string,
  status: SecurityAuditProgressStep["status"],
  detail?: string,
): SecurityAuditProgressStep {
  return { id, label, status, ...(detail ? { detail } : {}) };
}

function updateAudit(active: ActiveAudit, update: Partial<SecurityAudit>) {
  active.audit = {
    ...active.audit,
    ...update,
    id: active.audit.id,
    version: 1,
    sequence: active.audit.sequence + 1,
    updatedAt: new Date().toISOString(),
  };
  emitChanged(active);
  return active.audit;
}

function emitChanged(active: ActiveAudit) {
  if (!active.sender.isDestroyed()) {
    active.sender.send("security-audits:changed", {
      root: active.root,
      audit: active.audit,
    });
  }
}

function assertAuditActive(active: ActiveAudit) {
  if (active.cancelled) throw new Error("Security audit cancelled");
}

function securityAuditRunRequest(value: unknown) {
  const root = securityAuditRoot(value);
  const input = value as Record<string, unknown>;
  if (input.mode !== "standard" && input.mode !== "deep") {
    throw new Error("Security audit mode is invalid");
  }
  const scope = input.scope;
  if (scope !== undefined) {
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
      throw new Error("Security audit scope is invalid");
    }
    const candidate = scope as { type?: unknown; paths?: unknown };
    if (
      (candidate.type !== "repository" && candidate.type !== "paths") ||
      (candidate.paths !== undefined &&
        (!Array.isArray(candidate.paths) ||
          candidate.paths.some((path) => typeof path !== "string")))
    ) {
      throw new Error("Security audit scope is invalid");
    }
  }
  return { ...input, cwd: root, workspaceRoot: root } as RunSecurityAuditInput;
}

function securityAuditRoot(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Security audit request is invalid");
  }
  const root =
    (value as { root?: unknown; workspaceRoot?: unknown }).root ??
    (value as { workspaceRoot?: unknown }).workspaceRoot;
  if (typeof root !== "string" || !root || !isAbsolute(root)) {
    throw new Error("Security audit project root is invalid");
  }
  return resolve(root);
}

function securityAuditRequest(value: unknown) {
  const root = securityAuditRoot(value);
  const auditId = (value as { auditId?: unknown }).auditId;
  if (typeof auditId !== "string")
    throw new Error("Security audit id is invalid");
  return { root, auditId };
}
