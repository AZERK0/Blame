import { execa } from "execa";
import { redactSecuritySecrets } from "../security-secret-redaction.js";
import { EnvironmentAdapter } from "./environment-adapter.js";
import { blockedCommandReason } from "./command-policy.js";
import type { LightRunTaskInput, LightToolResult } from "./light-contracts.js";
import {
  dependencyManifestSections,
  LightDependencyService,
} from "./light-dependencies.js";
import { boundedDiagnostic } from "./light-diagnostic.js";
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

type ValidationMetadata = {
  reuseFailures?: boolean;
  reusePasses?: boolean;
  taskId?: string;
  taskKind?: string;
};

type FailureAssessment = {
  category: "code" | "environment";
  recovery: string;
};

type ReusableValidation = NonNullable<
  Awaited<ReturnType<SessionJournal["reusableValidation"]>>
>;

const reusableProjectTaskKinds = new Set<TaskCatalogItem["kind"]>([
  "build",
  "dependencies",
  "lint",
  "test",
  "typecheck",
]);

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
      if (task.kind === "service") return managedServiceResult(task.task_id);
      return await this.executeProjectTask(task, context);
    } catch (error) {
      const category =
        error instanceof TaskSelectionError ? "input" : "environment";
      return blocked(category, errorMessage(error));
    }
  }

  private async executeProjectTask(
    task: TaskCatalogItem,
    context: RunnerContext,
  ) {
    const invocation = taskInvocation(task);
    const cwd = await this.environment.cwd(invocation.cwd);
    return this.execute(
      invocation.executable,
      invocation.args,
      cwd,
      task.command,
      context,
      {
        reusePasses: reusableProjectTask(task),
        taskId: task.task_id,
        taskKind: task.kind,
      },
    );
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
        {
          reuseFailures: true,
          reusePasses: reusableInspection(input.command),
        },
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
      return {
        status: "ok",
        data: { changed: false, output: boundedDiagnostic(output, "", 4_000) },
      };
    const receipt = `d${++this.dependencyReceiptSequence}`;
    const sourceRevisionId = (await this.files.snapshot()).revision
      .source_revision_id;
    await this.recordDependency(input, paths, receipt, sourceRevisionId);
    const preview = await this.refreshPreviewDependencies?.();
    const data = {
      changed: true,
      paths,
      output: boundedDiagnostic(output, "", 4_000),
    };
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
    const reused = await this.reusedResult(command, metadata);
    if (reused) return reused;
    const result = await executeCommand(executable, args, cwd, context.signal);
    return this.recordedResult(command, result, metadata);
  }

  private async reusedResult(command: string, metadata: ValidationMetadata) {
    if (!metadata.reusePasses && !metadata.reuseFailures) return undefined;
    const sourceRevisionId = (await this.files.snapshot()).revision
      .source_revision_id;
    const candidate = await this.journal.reusableValidation(
      command,
      sourceRevisionId,
    );
    if (!candidate || !canReuseValidation(candidate, metadata))
      return undefined;
    return reusedCommandResult(command, candidate, this.environment.target());
  }

  private async recordedResult(
    command: string,
    result: Awaited<ReturnType<typeof executeCommand>>,
    metadata: ValidationMetadata,
  ): Promise<LightToolResult<unknown>> {
    const output = redactedOutput(
      result.all ?? `${result.stdout}\n${result.stderr}`,
    );
    const status = result.exitCode === 0 ? "passed" : "failed";
    const failure =
      result.exitCode === 0
        ? undefined
        : await commandFailureAssessment(output, this.files);
    const validatedRevisionId = (await this.files.snapshot()).revision
      .source_revision_id;
    await this.recordCommandValidation(
      command,
      status,
      validatedRevisionId,
      metadata,
      failure,
    );
    if (failure) return failedCommandResult(result.exitCode, output, failure);
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
    sourceRevisionId: string,
    metadata: ValidationMetadata,
    failure?: FailureAssessment,
  ) {
    const paths = await this.journal.currentChangedPaths();
    await this.journal.recordValidation({
      command,
      paths,
      sourceRevisionId,
      status,
      taskId: metadata.taskId,
      taskKind: metadata.taskKind,
      ...(failure
        ? { category: failure.category, recovery: failure.recovery }
        : {}),
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
      throw new TaskSelectionError(taskSelectionError(input.task, candidates));
    return candidates[0]!;
  }
}

class TaskSelectionError extends Error {}

function reusableProjectTask(task: TaskCatalogItem) {
  return reusableProjectTaskKinds.has(task.kind);
}

function canReuseValidation(
  validation: ReusableValidation,
  metadata: ValidationMetadata,
) {
  if (validation.status === "passed") return Boolean(metadata.reusePasses);
  return Boolean(
    validation.status === "failed" &&
    validation.category !== "environment" &&
    (metadata.reusePasses || metadata.reuseFailures),
  );
}

function reusableInspection(command: string) {
  if (/^\s*pwd\s*$/u.test(command)) return true;
  if (/[;&|\n]/u.test(command)) return false;
  return /^\s*git\s+(?:branch\s+--show-current|diff|log|rev-parse|show|status)\b/u.test(
    command,
  );
}

function managedServiceResult(taskId: string): LightToolResult<unknown> {
  return blocked(
    "environment",
    `Project task ${taskId} is a long-running service managed by the preview runtime.`,
    "Inspect the managed preview once when visual evidence matters. Do not start a replacement server or database from run_task.",
  );
}

function reusedCommandResult(
  command: string,
  validation: ReusableValidation,
  environment: string,
): LightToolResult<unknown> {
  if (validation.status === "passed")
    return {
      status: "ok",
      receipt: validation.id,
      data: {
        cached: true,
        command,
        environment,
        validatedAt: validation.timestamp,
      },
    };
  return {
    status: "blocked",
    category: validation.category ?? "code",
    message:
      "The identical command already failed at this source revision; it was not executed again.",
    recovery:
      validation.recovery ??
      "Change the relevant source or environment before requesting this validation again.",
  };
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
    all: true,
    cancelSignal: signal,
    cwd,
    reject: false,
    stdin: "ignore",
    timeout: 120_000,
    maxBuffer: 512 * 1024,
  });
}

function redactedOutput(output: string | Uint8Array) {
  return redactSecuritySecrets(String(output ?? "").trim());
}

function failedCommandResult(
  exitCode: number | undefined,
  output: string,
  failure: FailureAssessment,
): LightToolResult<unknown> {
  const diagnostic =
    boundedDiagnostic(output) || "No diagnostic output was produced.";
  return {
    status: "blocked",
    category: failure.category,
    message: `Command exited with code ${exitCode ?? "unknown"}.\n${diagnostic}`,
    recovery: failure.recovery,
  };
}

async function commandFailureAssessment(
  output: string,
  files: WorkspaceFiles,
): Promise<FailureAssessment> {
  const missing = missingDependencyNames(output);
  if (missing.length) {
    const declared = await declaredDependencies(files);
    if (missing.some((name) => declared.has(name)))
      return environmentDependencyFailure();
    return codeFailure();
  }
  return environmentDiagnostic(output) ? environmentFailure() : codeFailure();
}

function environmentDiagnostic(output: string) {
  return /(?:\bEAI_AGAIN\b|\bEACCES\b|\bECONN(?:REFUSED|RESET)?\b|\bENETUNREACH\b|\bENOSPC\b|\bENOENT\b|\bENOTFOUND\b|\bEPERM\b|\bETIMEDOUT\b|\bELOOP\b|\bP1001\b|broken (?:symbolic )?link|can't reach database server|command not found|connection refused|could not connect to server|dangling symlink|failed to connect|managed preview.*(?:failed|unavailable)|no space left on device|no such file or directory|PACKAGE_MANAGER_UNAVAILABLE|permission denied|preview (?:container|runtime).*(?:failed|unavailable)|\.prisma\/client)/iu.test(
    output,
  );
}

function missingDependencyNames(output: string) {
  const expressions = [
    /Cannot find (?:module|package)\s+['"`]([^'"`]+)['"`]/giu,
    /Module not found:\s*(?:Error:\s*)?Can't resolve\s+['"`]([^'"`]+)['"`]/giu,
  ];
  return expressions
    .flatMap((expression) => [...output.matchAll(expression)])
    .flatMap((match) => {
      const name = dependencyName(match[1] ?? "");
      return name ? [name] : [];
    });
}

function dependencyName(value: string) {
  if (
    !value ||
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.includes("\\")
  )
    return undefined;
  const segments = value.split("/");
  return value.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

async function declaredDependencies(files: WorkspaceFiles) {
  const names = new Set<string>();
  const snapshot = await files.snapshot();
  const manifests = snapshot.files.filter((path) =>
    path.endsWith("package.json"),
  );
  for (const path of manifests.slice(0, 200))
    for (const name of await manifestDependencies(files, path)) names.add(name);
  return names;
}

async function manifestDependencies(files: WorkspaceFiles, path: string) {
  try {
    const content = (await files.read(path)).content.toString("utf8");
    const manifest = JSON.parse(content) as Record<string, unknown>;
    return dependencyManifestSections.flatMap((key) =>
      Object.keys(record(manifest[key])),
    );
  } catch {
    return [];
  }
}

function codeFailure(): FailureAssessment {
  return {
    category: "code",
    recovery:
      "Fix the reported project error before running the relevant validation again.",
  };
}

function environmentDependencyFailure(): FailureAssessment {
  return {
    category: "environment",
    recovery:
      "Use the dependency operation once if the declared installation is incomplete; do not edit manifests or copy files through the shell.",
  };
}

function environmentFailure(): FailureAssessment {
  return {
    category: "environment",
    recovery:
      "Do not retry unchanged, alter dependencies, or start replacement databases, containers, or servers. Continue with available local validation; finish_task can report this validation unavailable.",
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
      output: boundedDiagnostic(output, "", 4_000),
      environment,
    },
  };
}

function blocked(
  category: "input" | "code" | "environment" | "external",
  message: string,
  recovery?: string,
): LightToolResult<unknown> {
  return {
    status: "blocked",
    category,
    message,
    ...(recovery ? { recovery } : {}),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
