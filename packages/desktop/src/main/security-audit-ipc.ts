import type {
  DiscoverSecurityAuditInput,
  MapSecurityAuditResult,
  RunSecurityAuditInput,
  SecurityAudit,
  SecurityAuditDiscoveryResult,
  SecurityFindingStatus,
  ValidateSecurityAuditInput,
  ValidateSecurityAuditResult,
} from "@blame/agent-runtime";
import { ipcMain, type WebContents } from "electron";
import { isAbsolute, resolve } from "node:path";

import { SecurityAuditStore } from "./security-audit-store";

type SecurityAuditIpcDependencies = {
  resolveInput(input: RunSecurityAuditInput): Promise<RunSecurityAuditInput>;
  map(input: RunSecurityAuditInput): Promise<MapSecurityAuditResult>;
  discover(
    input: DiscoverSecurityAuditInput,
  ): Promise<SecurityAuditDiscoveryResult>;
  validate(
    input: ValidateSecurityAuditInput,
  ): Promise<ValidateSecurityAuditResult>;
};

const store = new SecurityAuditStore();
const activeRoots = new Set<string>();

export function registerSecurityAuditIpcHandlers(
  dependencies: SecurityAuditIpcDependencies,
) {
  ipcMain.handle("security-audits:list", async (_event, input) => {
    const root = securityAuditRoot(input);
    if (!activeRoots.has(root)) await store.failInterrupted(root);
    return store.list(root);
  });
  ipcMain.handle("security-audits:get", (_event, input) => {
    const request = securityAuditRequest(input);
    return store.read(request.root, request.auditId);
  });
  ipcMain.handle("security-audits:update-finding", async (event, input) => {
    const request = securityFindingUpdateRequest(input);
    const audit = await store.updateFinding(
      request.root,
      request.auditId,
      request.fingerprint,
      request.update,
    );
    emitChanged(event.sender, request.root, audit);
    return audit;
  });
  ipcMain.handle("security-audits:run", (event, value) =>
    runSecurityAudit(
      event.sender,
      securityAuditRunRequest(value),
      dependencies,
    ),
  );
}

async function runSecurityAudit(
  sender: WebContents,
  input: RunSecurityAuditInput,
  dependencies: SecurityAuditIpcDependencies,
) {
  const root = securityAuditRoot(input);
  if (activeRoots.has(root)) {
    throw new Error("A security audit is already running for this project");
  }
  activeRoots.add(root);
  let audit: SecurityAudit | undefined;
  try {
    audit = await store.create(root, {
      analysisModel: {
        providerId: input.providerId,
        modelId: input.modelId,
        ...(input.reasoningEffort
          ? { reasoningEffort: input.reasoningEffort }
          : {}),
      },
      mode: input.mode,
      projectId: input.projectId,
      scope: input.scope ?? { type: "repository" },
    });
    emitChanged(sender, root, audit);
    audit = await updateAudit(sender, root, audit.id, { status: "mapping" });
    const resolved = await dependencies.resolveInput(input);
    const repository = await dependencies.map(resolved);
    audit = await updateAudit(sender, root, audit.id, {
      status: "discovery",
      revision: repository.revision,
      surfaceMap: repository.surfaceMap,
    });
    const runs = await Promise.allSettled(
      perspectives(input.mode).map((perspective) =>
        dependencies.discover({ ...resolved, perspective, repository }),
      ),
    );
    const agentDiscoveries = runs.map((run) => {
      if (run.status === "rejected") throw run.reason;
      return run.value;
    });
    const discoveries: SecurityAuditDiscoveryResult[] = [
      deterministicDiscovery(repository),
      ...agentDiscoveries,
    ];
    audit = await updateAudit(sender, root, audit.id, {
      status: "validation",
      candidateCount: discoveries.reduce(
        (count, discovery) => count + discovery.candidates.length,
        0,
      ),
      sessionIds: agentDiscoveries.map(({ sessionId }) => sessionId),
    });
    const validation = await dependencies.validate({
      ...resolved,
      repository,
      discoveries,
    });
    audit = await updateAudit(sender, root, audit.id, {
      status: "prioritization",
      sessionIds: [...audit.sessionIds, validation.sessionId],
    });
    const findings = await reconcileFindings(
      root,
      audit.id,
      validation.findings,
    );
    return updateAudit(sender, root, audit.id, {
      status: "completed",
      threatModel: validation.threatModel,
      coverage: validation.coverage,
      findings,
      candidateCount: validation.candidateCount,
      rejectedCandidateCount: validation.rejectedCandidateCount,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Security audit failed";
    if (audit) {
      try {
        audit = await updateAudit(sender, root, audit.id, {
          status: "failed",
          error: message,
          completedAt: new Date().toISOString(),
        });
      } catch {
        // Preserve the original audit failure if local persistence also fails.
      }
    }
    throw Object.assign(new Error(message), audit ? { audit } : {});
  } finally {
    activeRoots.delete(root);
  }
}

async function reconcileFindings(
  root: string,
  auditId: string,
  findings: SecurityAudit["findings"],
) {
  const previousAudits = (await store.list(root)).filter(
    (audit) => audit.id !== auditId && audit.status === "completed",
  );
  return findings.map((finding) => {
    const previousAudit = previousAudits.find((audit) =>
      audit.findings.some(
        (candidate) => candidate.fingerprint === finding.fingerprint,
      ),
    );
    const previous = previousAudit?.findings.find(
      (candidate) => candidate.fingerprint === finding.fingerprint,
    );
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
        previous?.firstSeenAuditId ?? previousAudit?.id ?? auditId,
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

async function updateAudit(
  sender: WebContents,
  root: string,
  auditId: string,
  update: Partial<SecurityAudit>,
) {
  const audit = await store.update(root, auditId, update);
  emitChanged(sender, root, audit);
  return audit;
}

function emitChanged(sender: WebContents, root: string, audit: SecurityAudit) {
  if (!sender.isDestroyed()) {
    sender.send("security-audits:changed", { root, audit });
  }
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

function securityFindingUpdateRequest(value: unknown) {
  const request = securityAuditRequest(value);
  const input = value as {
    fingerprint?: unknown;
    status?: unknown;
    backlogStoryId?: unknown;
  };
  if (typeof input.fingerprint !== "string") {
    throw new Error("Security finding fingerprint is invalid");
  }
  const statuses = new Set<SecurityFindingStatus>([
    "open",
    "fixing",
    "fixed",
    "accepted_risk",
    "false_positive",
    "regressed",
  ]);
  const status = statuses.has(input.status as SecurityFindingStatus)
    ? (input.status as SecurityFindingStatus)
    : undefined;
  const backlogStoryId =
    typeof input.backlogStoryId === "string" ? input.backlogStoryId : undefined;
  if (!status && !backlogStoryId)
    throw new Error("Security finding update is empty");
  return {
    ...request,
    fingerprint: input.fingerprint,
    update: {
      ...(status ? { status } : {}),
      ...(backlogStoryId ? { backlogStoryId } : {}),
    },
  };
}
