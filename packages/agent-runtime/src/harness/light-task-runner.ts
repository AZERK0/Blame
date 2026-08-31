import { execa } from "execa";
import { redactSecuritySecrets } from "../security-secret-redaction.js";
import { EnvironmentAdapter } from "./environment-adapter.js";
import { blockedCommandReason } from "./command-policy.js";
import type { LightRunTaskInput, LightToolResult } from "./light-contracts.js";
import { LightDependencyService } from "./light-dependencies.js";
import type { SessionJournal } from "./session-journal.js";
import {
  readTaskCatalog,
  taskInvocation,
  type TaskCatalogItem,
} from "./task-catalog.js";
import type { WorkspaceFiles } from "./workspace-files.js";

type RunnerContext = {
  sessionId?: string;
  toolCallId?: string;
  signal?: AbortSignal;
};

type LightTaskRunnerOptions = {
  files: WorkspaceFiles;
  journal: SessionJournal;
  refreshPreviewDependencies?: () => Promise<unknown>;
};

type ValidationMetadata = { taskId?: string; taskKind?: string };

export class LightTaskRunner {
  private readonly environment: EnvironmentAdapter;
  private readonly dependencies: LightDependencyService;
  private readonly files: WorkspaceFiles;
  private readonly journal: SessionJournal;
  private readonly refreshPreviewDependencies?: () => Promise<unknown>;
  private dependencyReceiptSequence = 0;

  constructor(options: LightTaskRunnerOptions) {
    this.files = options.files;
    this.journal = options.journal;
    this.environment = new EnvironmentAdapter(options.files);
    this.dependencies = new LightDependencyService(options.files);
    this.refreshPreviewDependencies = options.refreshPreviewDependencies;
  }

  run(input: LightRunTaskInput, context: RunnerContext = {}) {
    if (input.kind === "dependency") return this.dependency(input, context);
    if (input.kind === "project") return this.project(input, context);
    return this.command(input, context);
  }

  private async project(
    input: Extract<LightRunTaskInput, { kind: "project" }>,
    context: RunnerContext,
  ): Promise<LightToolResult<unknown>> {
    try {
      const task = await this.resolveProjectTask(input);
      const invocation = taskInvocation(task);
      const cwd = await this.environment.cwd(invocation.cwd);
      return await this.execute(
        invocation.executable,
        invocation.args,
        cwd,
        task.command,
        context,
        { taskId: task.task_id, taskKind: task.kind },
      );
    } catch (error) {
      return blocked("input", errorMessage(error));
    }
  }

  private async command(
    input: Extract<LightRunTaskInput, { kind: "command" }>,
    context: RunnerContext,
  ): Promise<LightToolResult<unknown>> {
    const denied = blockedCommandReason(input.command);
    if (denied) return blocked("input", denied);
    try {
      const invocation = this.environment.command(input.command);
      const cwd = await this.environment.cwd(input.cwd);
      return await this.execute(
        invocation.executable,
        invocation.args,
        cwd,
        input.command,
        context,
      );
    } catch (error) {
      return blocked("environment", errorMessage(error));
    }
  }

  private async dependency(
    input: Extract<LightRunTaskInput, { kind: "dependency" }>,
    context: RunnerContext,
  ): Promise<LightToolResult<unknown>> {
    try {
      const result = await this.dependencies.mutate(input, context.signal);
      if (result.status === "blocked")
        return blocked(result.category, result.message);
      return this.appliedDependency(input, result.changedPaths, result.output);
    } catch (error) {
      return blocked("environment", errorMessage(error));
    }
  }

  private async appliedDependency(
    input: Extract<LightRunTaskInput, { kind: "dependency" }>,
    paths: string[],
    output: string,
  ): Promise<LightToolResult<unknown>> {
    if (!paths.length)
      return { status: "ok", data: { changed: false, output } };
    const receipt = `d${++this.dependencyReceiptSequence}`;
    const sourceRevisionId = (await this.files.snapshot()).revision
      .source_revision_id;
    await this.recordDependency(input, paths, receipt, sourceRevisionId);
    const preview = await this.refreshPreviewDependencies?.();
    const data = { changed: true, paths, output: output.slice(0, 16_000) };
    if (preview === undefined) return { status: "ok", receipt, data };
    return {
      status: "ok",
      receipt,
      data: { ...data, preview },
    };
  }

  private async recordDependency(
    input: Extract<LightRunTaskInput, { kind: "dependency" }>,
    paths: string[],
    receipt: string,
    sourceRevisionId: string,
  ) {
    await this.journal.recordChange({
      parse: "not_supported",
      paths,
      receipt,
      sourceRevisionId,
      symbols: [],
    });
    await this.journal.recordValidation({
      command: `${input.action} ${input.packages.join(" ")}`,
      paths,
      sourceRevisionId,
      status: "passed",
      taskId: "dependency:consistency",
      taskKind: "build",
    });
  }

  private async execute(
    executable: string,
    args: string[],
    cwd: string,
    command: string,
    context: RunnerContext,
    metadata: ValidationMetadata = {},
  ): Promise<LightToolResult<unknown>> {
    const result = await executeCommand(executable, args, cwd, context.signal);
    const output = redactedOutput(result.stdout, result.stderr);
    const status = result.exitCode === 0 ? "passed" : "failed";
    await this.recordCommandValidation(command, status, metadata);
    if (result.exitCode !== 0)
      return failedCommandResult(result.exitCode, output);
    return passedCommandResult(
      command,
      result.exitCode,
      output,
      this.environment.target(),
    );
  }

  private async recordCommandValidation(
    command: string,
    status: "failed" | "passed",
    metadata: ValidationMetadata,
  ) {
    const paths = (await this.journal.completionSnapshot()).changedPaths;
    const sourceRevisionId = (await this.files.snapshot()).revision
      .source_revision_id;
    await this.journal.recordValidation({
      command,
      paths,
      sourceRevisionId,
      status,
      ...metadata,
    });
  }

  private async resolveProjectTask(
    input: Extract<LightRunTaskInput, { kind: "project" }>,
  ) {
    const snapshot = await this.files.snapshot();
    const tasks = await readTaskCatalog(this.files.root, snapshot.files);
    const packagePath = input.packagePath
      ? this.files.normalizePath(input.packagePath)
      : undefined;
    const scoped = packagePath
      ? tasks.filter((task) => packageMatches(task, packagePath))
      : tasks;
    const candidates = scoped.filter((task) => taskMatches(task, input.task));
    if (candidates.length !== 1)
      throw new Error(taskSelectionError(input.task, candidates));
    return candidates[0]!;
  }
}

function taskMatches(task: TaskCatalogItem, requested: string) {
  return (
    task.task_id === requested ||
    task.script === requested ||
    task.kind === requested
  );
}

function packageMatches(task: TaskCatalogItem, packagePath: string) {
  const normalized =
    packagePath.replace(/\/package\.json$/u, "").replace(/\/$/u, "") || ".";
  return task.cwd === normalized || task.task_id.startsWith(`${normalized}:`);
}

function taskSelectionError(task: string, candidates: TaskCatalogItem[]) {
  if (!candidates.length) return `No project task matches ${task}.`;
  return `Project task ${task} is ambiguous: ${candidates.map(({ task_id }) => task_id).join(", ")}.`;
}

function executeCommand(
  executable: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
) {
  return execa(executable, args, {
    cancelSignal: signal,
    cwd,
    reject: false,
    stdin: "ignore",
    timeout: 120_000,
    maxBuffer: 512 * 1024,
  });
}

function redactedOutput(
  stdout: string | Uint8Array,
  stderr: string | Uint8Array,
) {
  return redactSecuritySecrets(
    `${String(stdout ?? "")}\n${String(stderr ?? "")}`.trim(),
  );
}

function firstDiagnostic(output: string) {
  return output
    .split(/\r?\n/u)
    .find((line) => /(?:error|failed|fatal)/iu.test(line))
    ?.slice(0, 2_000);
}

function failedCommandResult(
  exitCode: number | undefined,
  output: string,
): LightToolResult<unknown> {
  return {
    status: "blocked",
    category: "code",
    message: firstDiagnostic(output) || `Command exited with code ${exitCode}.`,
    recovery:
      "Fix the reported project error before running the relevant validation again.",
  };
}

function passedCommandResult(
  command: string,
  exitCode: number | undefined,
  output: string,
  environment: string,
): LightToolResult<unknown> {
  return {
    status: "ok",
    data: {
      command,
      exitCode,
      output: output.slice(0, 16_000),
      environment,
    },
  };
}

function blocked(
  category: "input" | "code" | "environment" | "external",
  message: string,
): LightToolResult<unknown> {
  return { status: "blocked", category, message };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
