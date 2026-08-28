import { randomBytes } from "node:crypto";
import { join, relative } from "node:path";
import stripAnsi from "strip-ansi";
import { ArtifactStore } from "./artifact-store.js";
import { ChangeService } from "./change-service.js";
import { dependencyCacheRoot } from "./dependency-cache.js";
import { stableJson } from "./change-store.js";
import { environmentSpec } from "./environment-service.js";
import { sha256 } from "./protocol.js";
import { RunStore } from "./run-store.js";
import { TaskFailureCircuit } from "./task-failure-circuit.js";
import {
  RunAttemptStore,
  type RunAttempt,
  type RunAttemptStatus,
} from "./run-attempt-store.js";
import {
  inspectRunInputSchema,
  runTaskInputSchema,
  type InspectRunInput,
  type RunTaskInput,
  type StoredRun,
} from "./schemas.js";
import {
  readTaskCatalog,
  resolveTask,
  taskInvocation,
} from "./task-catalog.js";
import {
  automaticDependencyNetworkPolicy,
  SandboxedTaskExecutor,
  type TaskExecutionInput,
  type TaskExecutionResult,
  type TaskExecutor,
} from "./task-executor.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";
import { WorkspaceOverlay } from "./workspace-overlay.js";

export class RunService {
  private readonly artifacts: ArtifactStore;
  private readonly changes: ChangeService;
  private readonly executor: TaskExecutor;
  private readonly files: WorkspaceFiles;
  private readonly store: RunStore;
  private readonly attempts: RunAttemptStore;

  constructor(
    files: WorkspaceFiles,
    artifacts: ArtifactStore,
    changes: ChangeService,
    executor?: TaskExecutor,
  ) {
    this.files = files;
    this.artifacts = artifacts;
    this.changes = changes;
    this.executor = executor ?? new SandboxedTaskExecutor();
    this.store = new RunStore(files.root);
    this.attempts = new RunAttemptStore(files.root);
  }

  async run(
    input: RunTaskInput,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
    context: { sessionId?: string; toolCallId?: string } = {},
  ) {
    runTaskInputSchema.parse(input);
    const prepared = await this.startRunAttempt(input, snapshot, context);
    try {
      const run = await this.store.exclusiveIdempotency(
        prepared.idempotencyKey,
        () =>
          this.runUnlocked(
            prepared.effectiveInput,
            snapshot,
            signal,
            new TaskFailureCircuit(
              this.files.root,
              context.sessionId ?? "unscoped-session",
            ),
          ),
      );
      await this.finishRunAttempt(prepared.attempt, run);
      return {
        ...run,
        run_attempt_ref: prepared.attempt.run_attempt_ref,
        tool_call_id: prepared.toolCallId,
      };
    } catch (error) {
      await this.attempts.finish(
        prepared.attempt,
        signal?.aborted ? "cancelled" : "runtime_error",
        { error: errorMessage(error) },
      );
      throw error;
    }
  }

  private async startRunAttempt(
    input: RunTaskInput,
    snapshot: WorkspaceSnapshot,
    context: { sessionId?: string; toolCallId?: string },
  ) {
    const inputDigest = sha256(stableJson(input));
    const toolCallId = context.toolCallId ?? `direct-${inputDigest}`;
    const identity = `${context.sessionId ?? "unscoped-session"}\0${toolCallId}\0${inputDigest}`;
    const idempotencyKey =
      input.idempotency_key ?? `run-task:${sha256(identity)}`;
    const effectiveInput = { ...input, idempotency_key: idempotencyKey };
    const attempt = await this.attempts.start({
      environment: input.environment_profile ?? "default",
      identity,
      revision: snapshot.revision.source_revision_id,
      task: input.task,
      toolCallId,
    });
    return { attempt, effectiveInput, idempotencyKey, toolCallId };
  }

  private finishRunAttempt(attempt: RunAttempt, run: StoredRun) {
    return this.attempts.finish(attempt, terminalAttemptStatus(run.status), {
      runRef: run.run_ref,
    });
  }

  private async runUnlocked(
    input: RunTaskInput,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
    failureCircuit = new TaskFailureCircuit(
      this.files.root,
      "unscoped-session",
    ),
  ) {
    const catalog = await readTaskCatalog(this.files.root, snapshot.files);
    const task = resolveTask(catalog, input.task);
    assertSupportedExecution(input);
    if (task.kind === "service")
      throw new Error(
        "UNSUPPORTED_CAPABILITY:Long-running services use Blame Preview lifecycle and port leases, not run_task.",
      );
    const inputDigest = sha256(stableJson(input));
    if (input.idempotency_key) {
      const existing = await this.store.readByIdempotency(
        input.idempotency_key,
        inputDigest,
      );
      if (existing) return existing;
    }
    const environment = await environmentSpec(this.files, snapshot);
    const isolation = await this.executor.capability();
    const runtimeInstanceId = `runtime_${sha256(randomBytes(32)).slice(0, 32)}`;
    const startedAt = new Date();
    const overlay = await WorkspaceOverlay.materialize(
      this.files,
      snapshot,
      signal,
    );
    try {
      await this.assertCanonicalRevision(snapshot, signal);
      const invocation = taskInvocation(task, input.selection);
      const network =
        task.kind === "dependencies"
          ? await this.dependencyNetworkPolicy()
          : "deny";
      const packageCache = await dependencyCacheRoot(
        this.files.root,
        snapshot.files,
        task,
      );
      const executionInput: TaskExecutionInput = {
        executable: invocation.executable,
        args: invocation.args,
        cwd: join(overlay.workspace, invocation.cwd),
        overlayRoot: overlay.workspace,
        canonicalWorkspaceRoot: this.files.root,
        readonlyRoots: overlay.readonlyInputs,
        dependencyCacheRoot: packageCache,
        packageManager: task.package_manager,
        packageManagerCompatibility: "pnpm_same_major",
        packageManagerVersion: invocation.packageManagerVersion,
        timeoutMs: input.limits.timeout_ms,
        outputBytes: input.limits.output_bytes ?? 512 * 1024,
        signal,
        network,
      };
      const openCircuit = await failureCircuit.blocked();
      const result = openCircuit
        ? circuitOpenResult(isolation, openCircuit.message)
        : await this.executeTask(executionInput, isolation);
      const effects = await overlay.effects(signal);
      const canonicalUnchanged = await this.canonicalRevisionMatches(snapshot);
      const revision = {
        source_revision_id: snapshot.revision.source_revision_id,
        environment_spec_revision_id: environment.environment_spec_revision_id,
        runtime_instance_id: runtimeInstanceId,
      };
      const effectArtifact = await this.artifacts.put(
        JSON.stringify(
          {
            created: effects.created,
            modified: effects.modified,
            deleted: effects.deleted,
            truncated: effects.truncated,
            ...(effects.uncaptured_reason
              ? { uncaptured_reason: effects.uncaptured_reason }
              : {}),
          },
          null,
          2,
        ),
        "application/vnd.blame.filesystem-effects+json",
        "1.0",
        "agent_redacted",
        revision,
      );
      const proposal = await this.captureEffects({
        effects,
        input,
        inputDigest,
        canonicalUnchanged,
        sourceRevisionId: snapshot.revision.source_revision_id,
      });
      const cleanStdout = cleanOutput(result.stdout, overlay.workspace);
      const cleanStderr = cleanOutput(result.stderr, overlay.workspace);
      const redactedStdout = redactSensitiveOutput(cleanStdout);
      const redactedStderr = redactSensitiveOutput(cleanStderr);
      const rawLog = logDocument(result.stdout, result.stderr);
      const redactedLog = logDocument(redactedStdout, redactedStderr);
      const [completeLog, sealedRaw] = await Promise.all([
        this.artifacts.put(
          redactedLog,
          "text/plain",
          "1.0",
          "agent_redacted",
          revision,
        ),
        this.artifacts.put(rawLog, "text/plain", "1.0", "sealed_raw", revision),
      ]);
      const normalized = stripAnsi(`${redactedStderr}\n${redactedStdout}`);
      const runStatus = normalizedRunStatus(result.status, normalized);
      if (!openCircuit)
        await updateFailureCircuit(failureCircuit, runStatus, normalized);
      const completedAt = new Date();
      return this.store.write({
        schema_version: "1.0",
        source_revision: snapshot.revision,
        environment_spec_revision_id: environment.environment_spec_revision_id,
        runtime_instance_id: runtimeInstanceId,
        task,
        ...(input.selection ? { selection: input.selection } : {}),
        execution: {
          argv: [invocation.executable, ...invocation.args],
          cwd: invocation.cwd,
          environment_profile: input.environment_profile ?? "default",
          environment_variables: [
            "PATH",
            "HOME",
            "TMPDIR",
            "XDG_CACHE_HOME",
            "COREPACK_HOME",
            "COREPACK_ENABLE_DOWNLOAD_PROMPT",
            "COREPACK_ENABLE_PROJECT_SPEC",
            "npm_config_manage_package_manager_versions",
            "pnpm_config_manage_package_manager_versions",
            "npm_config_cache",
            "pnpm_config_store_dir",
            "YARN_CACHE_FOLDER",
            "CI",
            "NO_COLOR",
            "LANG",
            "LC_ALL",
          ],
          process_tree:
            isolation === "worktree"
              ? "host_descendants"
              : "sandbox_descendants",
          ...ignoredLimits(input),
          observed_ports: [],
          volatility: ["timestamps", "runtime_instance_id"],
          ...(result.packageManagerResolution
            ? {
                package_manager_resolution: {
                  name: result.packageManagerResolution.name,
                  ...(result.packageManagerResolution.requestedVersion
                    ? {
                        requested_version:
                          result.packageManagerResolution.requestedVersion,
                      }
                    : {}),
                  resolved_version:
                    result.packageManagerResolution.resolvedVersion,
                  strategy: result.packageManagerResolution.strategy,
                },
              }
            : {}),
        },
        status: runStatus,
        exit_code: result.exitCode,
        signal: result.signal,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        limits: input.limits,
        network: {
          requested: network,
          enforcement:
            network === "project_allowlist" ? "project_proxy" : isolation,
          effective: isolation === "worktree" ? "host" : "deny",
        },
        logs: {
          complete: completeLog,
          sealed_raw: sealedRaw,
          stdout_head: head(redactedStdout, 4_000),
          stdout_tail: tail(redactedStdout, 4_000),
          stderr_tail: tail(redactedStderr, 4_000),
          output_truncated: result.outputTruncated,
        },
        failures: extractFailures(normalized),
        diagnostics: extractDiagnostics(normalized, this.files.root),
        filesystem_effects: {
          created: effects.created,
          modified: effects.modified,
          deleted: effects.deleted,
          truncated: effects.truncated,
          disposition: proposal.disposition,
          artifact: effectArtifact,
          ...(proposal.ref ? { change_proposal_ref: proposal.ref } : {}),
          ...(proposal.reason ? { reason: proposal.reason } : {}),
        },
        ...(input.idempotency_key
          ? { idempotency_key: input.idempotency_key }
          : {}),
        input_digest: inputDigest,
      });
    } finally {
      await overlay.cleanup();
    }
  }

  read(ref: string) {
    return this.store.read(ref);
  }

  runsForProposal(ref: string) {
    return this.store.runsForProposal(ref);
  }

  runsForRevision(sourceRevisionId: string) {
    return this.store.runsForRevision(sourceRevisionId);
  }

  capability() {
    return this.executor.capability();
  }

  private async dependencyNetworkPolicy() {
    const declared = await this.executor.dependencyCapability?.();
    if (declared?.network === "managed_allowlist")
      return "project_allowlist" as const;
    if (declared?.network === "cache_only") return "deny" as const;
    return automaticDependencyNetworkPolicy();
  }

  private async executeTask(
    input: TaskExecutionInput,
    isolation: Awaited<ReturnType<TaskExecutor["capability"]>>,
  ) {
    const health = await this.executor.healthCheck?.(input);
    if (health && !health.available)
      return executionErrorResult(
        health.isolation,
        health.stderr ?? "Executor health check failed.",
      );
    return this.executor
      .execute(input)
      .catch((error) =>
        executionErrorResult(
          isolation,
          error instanceof Error ? error.message : String(error),
        ),
      );
  }

  async inspect(input: InspectRunInput) {
    inspectRunInputSchema.parse(input);
    const run = await this.store.read(input.run_ref);
    return inspectRunView(run, input.view);
  }

  private async captureEffects(input: {
    effects: Awaited<ReturnType<WorkspaceOverlay["effects"]>>;
    input: RunTaskInput;
    inputDigest: string;
    canonicalUnchanged: boolean;
    sourceRevisionId: string;
  }): Promise<{
    disposition: "captured" | "discarded" | "none";
    ref?: string;
    reason?: string;
  }> {
    const changed =
      input.effects.created.length +
      input.effects.modified.length +
      input.effects.deleted.length;
    if (!changed) return { disposition: "none" };
    if (!input.canonicalUnchanged)
      return {
        disposition: "discarded",
        reason: "Canonical source changed while the run was executing.",
      };
    if (input.effects.uncaptured_reason)
      return {
        disposition: "discarded",
        reason: input.effects.uncaptured_reason,
      };
    try {
      const proposal = await this.changes.proposeRunEffects({
        base_source_revision_id: input.sourceRevisionId,
        idempotency_key: `run-effects:${sha256(
          input.input.idempotency_key ?? input.inputDigest,
        )}`,
        input_digest: sha256(
          stableJson({
            input_digest: input.inputDigest,
            changes: input.effects.changes.map((change) => ({
              path: change.path,
              old_hash: change.oldHash,
              new_hash: change.newHash,
            })),
          }),
        ),
        changes: input.effects.changes,
      });
      return { disposition: "captured", ref: proposal.proposal_ref };
    } catch (error) {
      return {
        disposition: "discarded",
        reason: `Run effects could not become a proposal: ${errorMessage(error)}`,
      };
    }
  }

  private async assertCanonicalRevision(
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    if (!(await this.canonicalRevisionMatches(snapshot, signal)))
      throw new Error(
        `STALE_REVISION:${(await this.files.snapshot(signal)).revision.source_revision_id}`,
      );
  }

  private async canonicalRevisionMatches(
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    return (
      (await this.files.snapshot(signal)).revision.source_revision_id ===
      snapshot.revision.source_revision_id
    );
  }
}

export function publicRun(
  run: StoredRun & { run_attempt_ref?: string; tool_call_id?: string },
) {
  return {
    run_ref: run.run_ref,
    ...(run.run_attempt_ref ? { run_attempt_ref: run.run_attempt_ref } : {}),
    ...(run.tool_call_id ? { tool_call_id: run.tool_call_id } : {}),
    source_revision: run.source_revision,
    environment_spec_revision_id: run.environment_spec_revision_id,
    runtime_instance_id: run.runtime_instance_id,
    task: run.task,
    execution: run.execution,
    status: run.status,
    outcome:
      run.status === "execution_error"
        ? "infrastructure_error"
        : run.status === "failed"
          ? "task_failure"
          : run.status,
    exit_code: run.exit_code,
    duration_ms: run.duration_ms,
    failures: run.failures.slice(0, 10),
    diagnostics: run.diagnostics.slice(0, 30),
    ...(run.logs.stderr_tail.trim()
      ? { stderr_summary: compact(run.logs.stderr_tail, 1_000) }
      : {}),
    filesystem_effects: run.filesystem_effects,
    complete_log: run.logs.complete,
  };
}

function normalizedRunStatus(
  status: StoredRun["status"],
  output: string,
): StoredRun["status"] {
  if (status !== "failed") return status;
  return infrastructureRunFailure(output) ? "execution_error" : status;
}

function infrastructureRunFailure(output: string) {
  return /\b(?:corepack|econnrefused|enotfound|package manager unavailable|executor unavailable|executable unavailable)\b|BLAME_PROJECT_ALLOWLIST_PROXY|bwrap:\s+execvp/iu.test(
    output,
  );
}

async function updateFailureCircuit(
  circuit: TaskFailureCircuit,
  status: StoredRun["status"],
  output: string,
) {
  if (status === "execution_error") {
    await circuit.recordFailure(output || "Unknown executor failure.");
    return;
  }
  await circuit.reset();
}

function circuitOpenResult(
  isolation: TaskExecutionResult["isolation"],
  previousFailure: string,
) {
  return executionErrorResult(
    isolation,
    `EXECUTOR_CIRCUIT_OPEN:Three identical infrastructure failures were observed. The task was not started. Last failure: ${previousFailure}`,
  );
}

function executionErrorResult(
  isolation: TaskExecutionResult["isolation"],
  stderr: string,
): TaskExecutionResult {
  return {
    status: "execution_error",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr,
    outputTruncated: false,
    isolation,
  };
}

function inspectRunView(run: StoredRun, view: InspectRunInput["view"]) {
  if (view === "summary") return publicRun(run);
  if (view === "failures") return { run_ref: run.run_ref, items: run.failures };
  if (view === "diagnostics")
    return { run_ref: run.run_ref, items: run.diagnostics };
  if (view === "filesystem_effects")
    return { run_ref: run.run_ref, ...run.filesystem_effects };
  if (view === "performance")
    return {
      run_ref: run.run_ref,
      duration_ms: run.duration_ms,
      limits: run.limits,
      network: run.network,
      execution: run.execution,
    };
  if (view === "stdout_head")
    return { run_ref: run.run_ref, content: run.logs.stdout_head };
  if (view === "stdout_tail")
    return { run_ref: run.run_ref, content: run.logs.stdout_tail };
  if (view === "stderr_tail")
    return { run_ref: run.run_ref, content: run.logs.stderr_tail };
  return {
    run_ref: run.run_ref,
    events: [
      { at: run.started_at, type: "started" },
      { at: run.completed_at, type: run.status },
    ],
  };
}

function assertSupportedExecution(input: RunTaskInput) {
  if (input.selection?.symbols?.length)
    throw new Error(
      "UNSUPPORTED_CAPABILITY:Symbol-level test selection requires the P1 compiler/LSP adapter. Select tests or files instead.",
    );
}

function ignoredLimits(input: RunTaskInput) {
  const limits: Array<"cpu" | "memory_mb"> = [];
  if (input.limits.cpu !== undefined) limits.push("cpu");
  if (input.limits.memory_mb !== undefined) limits.push("memory_mb");
  return limits.length ? { ignored_limits: limits } : {};
}

function extractFailures(output: string) {
  const lines = output.split(/\r?\n/);
  return lines
    .filter((line) => /(^|\s)(FAIL|failed|error|not ok)(\s|:|$)/i.test(line))
    .map((line) => ({ message: compact(line, 2_000) }))
    .filter((item) => item.message)
    .slice(0, 100);
}

function extractDiagnostics(output: string, workspaceRoot: string) {
  const diagnostics: Array<{
    severity: "error" | "warning" | "info";
    message: string;
    path?: string;
    line?: number;
    column?: number;
  }> = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /^(.*?):(\d+):(\d+)(?:\s*-\s*|\s+)(error|warning|info)?\s*(.*)$/i,
    );
    if (!match) continue;
    const reportedPath = match[1]!;
    const path = reportedPath.startsWith("<workspace>/")
      ? reportedPath.slice("<workspace>/".length)
      : relative(workspaceRoot, reportedPath).replaceAll("\\", "/");
    if (!path || path === ".." || path.startsWith("../")) continue;
    diagnostics.push({
      severity:
        match[4]?.toLowerCase() === "warning"
          ? "warning"
          : match[4]?.toLowerCase() === "info"
            ? "info"
            : "error",
      message: compact(match[5] ?? line, 2_000),
      path,
      line: Number(match[2]),
      column: Number(match[3]),
    });
    if (diagnostics.length >= 500) break;
  }
  return [...missingDependencyDiagnostics(output), ...diagnostics].slice(
    0,
    500,
  );
}

function missingDependencyDiagnostics(output: string) {
  const dependencies = new Set<string>();
  for (const expression of missingDependencyExpressions) {
    for (const match of output.matchAll(expression)) {
      const dependency = match[1]?.trim();
      if (dependency && plausibleDependency(dependency))
        dependencies.add(dependency);
    }
  }
  return [...dependencies].slice(0, 20).map((dependency) => ({
    code: "DEPENDENCY_MISSING",
    severity: "error" as const,
    message: `Dependency ${dependency} is missing from the execution environment.`,
    dependency,
    installation_supported: false,
    recommendation:
      "The package is neither declared nor installed. Do not probe alternate node_modules paths; use the dependency inventory and capability alternatives from workspace_state.",
  }));
}

const missingDependencyExpressions = [
  /Cannot find (?:module|package)\s+['"]([^'"]+)['"]/giu,
  /Module not found:\s*(?:Error:\s*)?Can't resolve\s+['"]([^'"]+)['"]/giu,
  /^(?:[^:\r\n]+:\s*)?(?:(?:line\s+)?\d+:\s*)?([^:\s]+):\s*(?:command\s+)?not found\s*$/gimu,
  /['"]?([^'"\r\n]+?)['"]?\s+is not recognized as an internal or external command/giu,
];

function plausibleDependency(value: string) {
  return /^(?:@[^/\s]+\/)?[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value);
}

function cleanOutput(value: string, overlayRoot: string) {
  return stripAnsi(value).replaceAll(overlayRoot, "<workspace>");
}

function redactSensitiveOutput(value: string) {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}\b/gi, "$1[REDACTED]")
    .replace(
      /\b(api[_-]?key|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    );
}

function logDocument(stdout: string, stderr: string) {
  return [`[stdout]\n${stdout}`, `[stderr]\n${stderr}`].join("\n");
}

function head(value: string, maximum: number) {
  return value.slice(0, maximum);
}

function tail(value: string, maximum: number) {
  return value.slice(Math.max(0, value.length - maximum));
}

function compact(value: string, maximum: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function terminalAttemptStatus(
  status: StoredRun["status"],
): Exclude<RunAttemptStatus, "running"> {
  return status === "execution_error" ? "runtime_error" : status;
}
