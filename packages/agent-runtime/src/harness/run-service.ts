import { randomBytes } from "node:crypto";
import { join, relative } from "node:path";
import stripAnsi from "strip-ansi";
import { ArtifactStore } from "./artifact-store.js";
import { ChangeService } from "./change-service.js";
import { stableJson } from "./change-store.js";
import { environmentSpec } from "./environment-service.js";
import { sha256 } from "./protocol.js";
import { RunStore } from "./run-store.js";
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
import { SandboxedTaskExecutor, type TaskExecutor } from "./task-executor.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";
import { WorkspaceOverlay } from "./workspace-overlay.js";

export class RunService {
  private readonly artifacts: ArtifactStore;
  private readonly changes: ChangeService;
  private readonly executor: TaskExecutor;
  private readonly files: WorkspaceFiles;
  private readonly store: RunStore;

  constructor(
    files: WorkspaceFiles,
    artifacts: ArtifactStore,
    changes: ChangeService,
    executor: TaskExecutor = new SandboxedTaskExecutor(),
  ) {
    this.files = files;
    this.artifacts = artifacts;
    this.changes = changes;
    this.executor = executor;
    this.store = new RunStore(files.root);
  }

  async run(
    input: RunTaskInput,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    runTaskInputSchema.parse(input);
    if (input.idempotency_key)
      return this.store.exclusiveIdempotency(input.idempotency_key, () =>
        this.runUnlocked(input, snapshot, signal),
      );
    return this.runUnlocked(input, snapshot, signal);
  }

  private async runUnlocked(
    input: RunTaskInput,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    assertSupportedExecution(input);
    const catalog = await readTaskCatalog(this.files.root, snapshot.files);
    const task = resolveTask(catalog, input.task);
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
      const result = await this.executor.execute({
        executable: invocation.executable,
        args: invocation.args,
        cwd: join(overlay.workspace, invocation.cwd),
        overlayRoot: overlay.workspace,
        canonicalWorkspaceRoot: this.files.root,
        readonlyRoots: overlay.readonlyInputs,
        timeoutMs: input.limits.timeout_ms,
        outputBytes: input.limits.output_bytes ?? 512 * 1024,
        signal,
      });
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
        },
        status: result.status,
        exit_code: result.exitCode,
        signal: result.signal,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        limits: input.limits,
        network: {
          requested: input.network ?? "deny",
          enforcement: isolation,
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

  capability() {
    return this.executor.capability();
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

export function publicRun(run: StoredRun) {
  return {
    run_ref: run.run_ref,
    source_revision: run.source_revision,
    environment_spec_revision_id: run.environment_spec_revision_id,
    runtime_instance_id: run.runtime_instance_id,
    task: run.task,
    execution: run.execution,
    status: run.status,
    exit_code: run.exit_code,
    duration_ms: run.duration_ms,
    failures: run.failures.slice(0, 10),
    diagnostics: run.diagnostics.slice(0, 30),
    filesystem_effects: run.filesystem_effects,
    complete_log: run.logs.complete,
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
  if (input.network === "project_allowlist")
    throw new Error(
      "UNSUPPORTED_CAPABILITY:Project network allowlists require the managed cloud execution adapter; run_task currently supports default-deny only.",
    );
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
  return diagnostics;
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
