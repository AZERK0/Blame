import { randomBytes } from "node:crypto";
import { join, relative } from "node:path";
import stripAnsi from "strip-ansi";
import { ArtifactStore } from "./artifact-store.js";
import { ChangeService } from "./change-service.js";
import { dependencyCacheRoot } from "./dependency-cache.js";
import {
  DependencyEnvironmentService,
  declaredDependencyPackages,
  probeDependencyEnvironment,
  type DependencyEnvironment,
} from "./dependency-environment.js";
import { stableJson } from "./change-store.js";
import {
  environmentSpec,
  type EnvironmentSpec,
} from "./environment-service.js";
import { sha256 } from "./protocol.js";
import { RunStore } from "./run-store.js";
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
  type TaskCatalogItem,
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

type PreparedRunRuntime = {
  catalog: TaskCatalogItem[];
  task: TaskCatalogItem;
  dependencyEnvironment?: DependencyEnvironment;
  environment: EnvironmentSpec;
};

type RunExecution = {
  repaired: boolean;
  run: StoredRun;
  reused: boolean;
};

export class RunService {
  private readonly artifacts: ArtifactStore;
  private readonly changes: ChangeService;
  private readonly executor: TaskExecutor;
  private readonly files: WorkspaceFiles;
  private readonly environments: DependencyEnvironmentService;
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
    this.environments = new DependencyEnvironmentService(files.root);
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
    const prepared = await this.startRunAttempt(
      input,
      snapshot,
      signal,
      context,
    );
    try {
      const execution = await this.store.exclusiveIdempotency<RunExecution>(
        prepared.idempotencyKey,
        () =>
          this.runUnlocked(
            prepared.effectiveInput,
            snapshot,
            signal,
            false,
            prepared.runtime,
          ),
      );
      await this.finishRunAttempt(prepared.attempt, execution.run);
      return {
        ...execution.run,
        run_attempt_ref: prepared.attempt.run_attempt_ref,
        tool_call_id: prepared.toolCallId,
        deduplication: {
          reused: execution.reused,
          required_state_change: execution.reused
            ? "source_or_environment_revision"
            : "none",
        },
        environment_repair: {
          attempted: execution.repaired,
          status: execution.repaired
            ? ("recovered" as const)
            : ("not_needed" as const),
        },
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
    signal: AbortSignal | undefined,
    context: { sessionId?: string; toolCallId?: string },
  ) {
    const runtime = await this.prepareRuntime(input, snapshot, signal);
    const inputDigest = deterministicRunDigest(input, snapshot, runtime);
    const toolCallId = context.toolCallId ?? `direct-${inputDigest}`;
    const identity = `run-task\0${inputDigest}`;
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
    return { attempt, effectiveInput, idempotencyKey, runtime, toolCallId };
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
    repairAttempted = false,
    preparedRuntime?: PreparedRunRuntime,
  ): Promise<RunExecution> {
    const runtime =
      preparedRuntime ?? (await this.prepareRuntime(input, snapshot, signal));
    const { catalog, task } = runtime;
    const inputDigest = sha256(stableJson(input));
    if (input.idempotency_key) {
      const existing = await this.store.readByIdempotency(
        input.idempotency_key,
        inputDigest,
      );
      if (existing) return { repaired: false, run: existing, reused: true };
    }
    let dependencyEnvironment = runtime.dependencyEnvironment;
    let environment = runtime.environment;
    const isolation = await this.executor.capability();
    const runtimeInstanceId = `runtime_${sha256(randomBytes(32)).slice(0, 32)}`;
    const startedAt = new Date();
    const overlay = await WorkspaceOverlay.materialize(
      this.files,
      snapshot,
      signal,
      task.kind === "dependencies" ? "writable_dependencies" : "readonly",
      dependencyEnvironment?.workspace,
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
        dependencyInstall: task.kind === "dependencies",
      };
      const result = await this.executeTask(executionInput, isolation);
      const declaredPackages = await declaredDependencyPackages(
        this.files.root,
        snapshot.files,
      );
      const missingDeclaredModules =
        task.kind !== "dependencies" &&
        dependencyEnvironment &&
        !repairAttempted
          ? await missingDeclaredDependencyModules(
              result,
              dependencyEnvironment,
              snapshot.files,
              declaredPackages,
            )
          : [];
      if (
        (repairableDependencyFailure(result) ||
          missingDeclaredModules.length > 0) &&
        task.kind !== "dependencies" &&
        dependencyEnvironment &&
        !repairAttempted
      ) {
        await this.environments.invalidate(
          dependencyEnvironment.spec.environment_revision_id,
        );
        const dependencyTask = catalog.find(
          (candidate) => candidate.kind === "dependencies",
        );
        if (!dependencyTask)
          throw new Error(
            "ENVIRONMENT_REPAIR_FAILED:Dependency task unavailable.",
          );
        const restored = await this.restoreDependencyEnvironment(
          dependencyTask,
          snapshot,
          signal,
        );
        const repaired = await this.runUnlocked(input, snapshot, signal, true, {
          catalog,
          task,
          dependencyEnvironment: restored,
          environment: restored.spec,
        });
        return { ...repaired, repaired: true };
      }
      if (task.kind === "dependencies" && result.status === "passed") {
        dependencyEnvironment = await this.environments.persist({
          files: this.files,
          snapshot,
          sourceWorkspace: overlay.workspace,
          task,
          resolvedVersion:
            result.packageManagerResolution?.resolvedVersion ??
            task.package_manager_version ??
            "unversioned",
        });
        environment = dependencyEnvironment.spec;
      }
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
      const completedAt = new Date();
      const run = await this.store.write({
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
            "COREPACK_ENABLE_STRICT",
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
        diagnostics: extractDiagnostics(
          normalized,
          this.files.root,
          declaredPackages,
        ),
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
      return { repaired: repairAttempted, run, reused: false };
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

  private async prepareRuntime(
    input: RunTaskInput,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ): Promise<PreparedRunRuntime> {
    const catalog = await readTaskCatalog(this.files.root, snapshot.files);
    const task = resolveTask(catalog, input.task);
    assertSupportedTask(input, task);
    const dependencyEnvironment =
      task.kind === "dependencies"
        ? undefined
        : await this.ensureDependencyEnvironment(catalog, snapshot, signal);
    const environment =
      dependencyEnvironment?.spec ??
      (await environmentSpec(this.files, snapshot, {
        executionProfile: input.environment_profile,
        packageManager: task.package_manager,
        resolvedPackageManagerVersion:
          task.package_manager_version ?? "unversioned",
      }));
    return { catalog, task, dependencyEnvironment, environment };
  }

  private async ensureDependencyEnvironment(
    catalog: TaskCatalogItem[],
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    const dependencyTask = catalog.find((task) => task.kind === "dependencies");
    if (!dependencyTask)
      throw new Error("ENVIRONMENT_REPAIR_FAILED:Dependency task unavailable.");
    const current = await this.environments.current(
      this.files,
      snapshot,
      dependencyTask,
    );
    if (current) return current;
    const worktreeProbe = await probeDependencyEnvironment(
      this.files.root,
      snapshot.files,
    );
    if (worktreeProbe.status === "passed")
      return await this.environments.persist({
        files: this.files,
        snapshot,
        sourceWorkspace: this.files.root,
        task: dependencyTask,
        resolvedVersion:
          dependencyTask.package_manager_version ?? "unversioned",
      });
    return this.restoreDependencyEnvironment(dependencyTask, snapshot, signal);
  }

  private async restoreDependencyEnvironment(
    task: TaskCatalogItem,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    const overlay = await WorkspaceOverlay.materialize(
      this.files,
      snapshot,
      signal,
      "writable_dependencies",
    );
    try {
      const invocation = taskInvocation(task);
      const executionInput: TaskExecutionInput = {
        executable: invocation.executable,
        args: invocation.args,
        cwd: join(overlay.workspace, invocation.cwd),
        overlayRoot: overlay.workspace,
        canonicalWorkspaceRoot: this.files.root,
        readonlyRoots: overlay.readonlyInputs,
        dependencyCacheRoot: await dependencyCacheRoot(
          this.files.root,
          snapshot.files,
          task,
        ),
        packageManager: task.package_manager,
        packageManagerCompatibility: "pnpm_same_major",
        packageManagerVersion: invocation.packageManagerVersion,
        timeoutMs: 300_000,
        outputBytes: 256 * 1024,
        signal,
        network: await this.dependencyNetworkPolicy(),
        dependencyInstall: true,
      };
      const result = await this.executeTask(
        executionInput,
        await this.executor.capability(),
      );
      if (result.status !== "passed")
        throw new Error(
          `ENVIRONMENT_REPAIR_FAILED:${result.stderr || result.stdout}`,
        );
      return await this.environments.persist({
        files: this.files,
        snapshot,
        sourceWorkspace: overlay.workspace,
        task,
        resolvedVersion:
          result.packageManagerResolution?.resolvedVersion ??
          task.package_manager_version ??
          "unversioned",
      });
    } finally {
      await overlay.cleanup();
    }
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
  run: StoredRun & {
    run_attempt_ref?: string;
    tool_call_id?: string;
    deduplication?: {
      reused: boolean;
      required_state_change: string;
    };
    environment_repair?: {
      attempted: boolean;
      status: "not_needed" | "recovered";
    };
  },
) {
  return {
    run_ref: run.run_ref,
    ...(run.run_attempt_ref ? { run_attempt_ref: run.run_attempt_ref } : {}),
    ...(run.tool_call_id ? { tool_call_id: run.tool_call_id } : {}),
    ...(run.deduplication ? { deduplication: run.deduplication } : {}),
    ...(run.environment_repair
      ? { environment_repair: run.environment_repair }
      : {}),
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
  return /\b(?:corepack|econnrefused|enotfound|enetunreach|package manager unavailable|executor unavailable|executable unavailable)\b|BLAME_PROJECT_ALLOWLIST_PROXY|bwrap:\s+execvp|(?:registry|packages?)\.[^\s/]+\/[^\s:]+:\s+fetch failed/iu.test(
    output,
  );
}

function repairableDependencyFailure(result: TaskExecutionResult) {
  if (result.status !== "execution_error") return false;
  return /\b(?:node_modules|symlink|dependency|package|module|executable)\b/iu.test(
    `${result.stderr}\n${result.stdout}`,
  );
}

async function missingDeclaredDependencyModules(
  result: TaskExecutionResult,
  environment: DependencyEnvironment,
  sourceFiles: string[],
  declaredPackages: Set<string>,
) {
  if (result.status !== "failed") return [];
  const missingModules = missingModuleSpecifiers(
    `${result.stderr}\n${result.stdout}`,
  ).filter((specifier) => {
    const packageName = modulePackageName(specifier);
    return packageName ? declaredPackages.has(packageName) : false;
  });
  if (!missingModules.length) return [];
  const probe = await probeDependencyEnvironment(
    environment.workspace,
    sourceFiles,
    missingModules,
  );
  return probe.status === "failed" ? missingModules : [];
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

function assertSupportedTask(input: RunTaskInput, task: TaskCatalogItem) {
  if (task.kind === "service")
    throw new Error(
      "UNSUPPORTED_CAPABILITY:Long-running services use Blame Preview lifecycle and port leases, not run_task.",
    );
  if (input.selection?.symbols?.length)
    throw new Error(
      "UNSUPPORTED_CAPABILITY:Symbol-level test selection requires the P1 compiler/LSP adapter. Select tests or files instead.",
    );
}

function deterministicRunDigest(
  input: RunTaskInput,
  snapshot: WorkspaceSnapshot,
  runtime: PreparedRunRuntime,
) {
  return sha256(
    stableJson({
      task: runtime.task,
      source_revision_id: snapshot.revision.source_revision_id,
      environment_revision_id: runtime.environment.environment_revision_id,
      selection: input.selection ?? null,
      relevant_configuration: {
        environment_profile: input.environment_profile ?? "default",
        limits: input.limits,
      },
    }),
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

function extractDiagnostics(
  output: string,
  workspaceRoot: string,
  declaredPackages: Set<string>,
) {
  const diagnostics = output
    .split(/\r?\n/)
    .map((line) => sourceDiagnostic(line, workspaceRoot))
    .filter((diagnostic) => diagnostic !== undefined)
    .slice(0, 500);
  return [
    ...missingDependencyDiagnostics(output, declaredPackages),
    ...diagnostics,
  ].slice(0, 500);
}

function sourceDiagnostic(line: string, workspaceRoot: string) {
  const match = line.match(
    /^(.*?):(\d+):(\d+)(?:\s*-\s*|\s+)(error|warning|info)?\s*(.*)$/i,
  );
  if (!match) return undefined;
  const reportedPath = match[1]!;
  const path = reportedPath.startsWith("<workspace>/")
    ? reportedPath.slice("<workspace>/".length)
    : relative(workspaceRoot, reportedPath).replaceAll("\\", "/");
  if (!path || path === ".." || path.startsWith("../")) return undefined;
  const reportedSeverity = match[4]?.toLowerCase();
  const severity = ["warning", "info"].includes(reportedSeverity ?? "")
    ? (reportedSeverity as "info" | "warning")
    : ("error" as const);
  return {
    severity,
    message: compact(match[5] ?? line, 2_000),
    path,
    line: Number(match[2]),
    column: Number(match[3]),
  };
}

function missingDependencyDiagnostics(
  output: string,
  declaredPackages: Set<string>,
) {
  return missingDependencies(output)
    .slice(0, 20)
    .map((dependency) =>
      missingDependencyDiagnostic(dependency, declaredPackages),
    );
}

const missingModuleExpressions = [
  /Cannot find (?:module|package)\s+['"]([^'"]+)['"]/giu,
  /Module not found:\s*(?:Error:\s*)?Can't resolve\s+['"]([^'"]+)['"]/giu,
];

const missingDependencyExpressions = [
  ...missingModuleExpressions,
  /^(?:[^:\r\n]+:\s*)?(?:(?:line\s+)?\d+:\s*)?([^:\s]+):\s*(?:command\s+)?not found\s*$/gimu,
  /['"]?([^'"\r\n]+?)['"]?\s+is not recognized as an internal or external command/giu,
];

function missingModuleSpecifiers(output: string) {
  return matchedDependencies(output, missingModuleExpressions);
}

function missingDependencies(output: string) {
  return matchedDependencies(output, missingDependencyExpressions);
}

function matchedDependencies(output: string, expressions: RegExp[]) {
  const dependencies = new Set<string>();
  for (const expression of expressions)
    for (const match of output.matchAll(expression)) {
      const dependency = match[1]?.trim();
      if (dependency && plausibleDependency(dependency))
        dependencies.add(dependency);
    }
  return [...dependencies];
}

function missingDependencyDiagnostic(
  dependency: string,
  declaredPackages: Set<string>,
) {
  const declared = declaredPackages.has(modulePackageName(dependency) ?? "");
  return {
    code: "DEPENDENCY_MISSING",
    severity: "error" as const,
    message: declared
      ? `Declared dependency module ${dependency} could not be loaded after environment verification.`
      : `Dependency ${dependency} is missing from the execution environment.`,
    dependency,
    installation_supported: declared,
    recommendation: declared
      ? "The repaired environment passed its probe. Verify the requested module path and declared package version."
      : "The package is not declared. Use mutate_dependencies when it is required by the requested change.",
  };
}

function modulePackageName(specifier: string) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.length >= 2
      ? `${segments[0]}/${segments[1]}`
      : undefined
    : segments[0];
}

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
