import { dirname } from "node:path";
import { execa } from "execa";
import { redactSecuritySecrets } from "../security-secret-redaction.js";
import {
  resolvePackageManager,
  type PackageManagerName,
} from "./package-manager-runtime.js";
import { LightCommitService, type LightFileMutation } from "./light-commit.js";
import type { LightRunTaskInput } from "./light-contracts.js";
import { readTaskCatalog } from "./task-catalog.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

type DependencyInput = Extract<LightRunTaskInput, { kind: "dependency" }>;

export type LightDependencyResult =
  | { changedPaths: string[]; output: string; status: "applied" }
  | {
      category: "code" | "environment";
      message: string;
      status: "blocked";
    };

export class LightDependencyService {
  private readonly commits: LightCommitService;
  private readonly files: WorkspaceFiles;

  constructor(files: WorkspaceFiles) {
    this.files = files;
    this.commits = new LightCommitService(files);
  }

  mutate(input: DependencyInput, signal?: AbortSignal) {
    return this.commits.exclusive(() => this.mutateLocked(input, signal));
  }

  private async mutateLocked(
    input: DependencyInput,
    signal?: AbortSignal,
  ): Promise<LightDependencyResult> {
    const snapshot = await this.files.snapshot(signal);
    const manifest = manifestPath(this.files, input.packagePath);
    await this.files.read(manifest);
    const before = await snapshotDependencyFiles(this.files, snapshot);
    try {
      const execution = await this.execute(input, manifest, snapshot, signal);
      if (execution.exitCode !== 0)
        return await this.rollbackFailure(before, execution.output);
      const changedPaths = await changedDependencyPaths(this.files, before);
      return { status: "applied", changedPaths, output: execution.output };
    } catch (error) {
      return this.rollbackFailure(before, errorMessage(error));
    }
  }

  private async execute(
    input: DependencyInput,
    manifest: string,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    const manager = await projectPackageManager(this.files, snapshot);
    const resolved = await resolvePackageManager({
      name: manager.name,
      version: manager.version,
      compatibility: manager.name === "pnpm" ? "pnpm_same_major" : undefined,
    });
    const args = [
      ...resolved.argsPrefix,
      ...dependencyArguments(manager.name, input),
    ];
    const result = await execa(resolved.executable, args, {
      cancelSignal: signal,
      cwd: dirname(this.files.resolveForWrite(manifest).absolute),
      maxBuffer: 512 * 1024,
      reject: false,
      stdin: "ignore",
      timeout: 120_000,
    });
    return { exitCode: result.exitCode, output: processOutput(result) };
  }

  private async rollbackFailure(
    before: LightFileMutation[],
    diagnostic: string,
  ): Promise<LightDependencyResult> {
    await this.commits.restoreFiles(before);
    return {
      status: "blocked",
      category: dependencyFailureCategory(diagnostic),
      message: firstDiagnostic(diagnostic),
    };
  }
}

async function projectPackageManager(
  files: WorkspaceFiles,
  snapshot: WorkspaceSnapshot,
) {
  const task = (await readTaskCatalog(files.root, snapshot.files)).find(
    ({ kind }) => kind === "dependencies",
  );
  if (!task) throw new Error("No package manager was detected.");
  return {
    name: task.package_manager as PackageManagerName,
    version: task.package_manager_version,
  };
}

function dependencyArguments(
  manager: PackageManagerName,
  input: DependencyInput,
) {
  const packages =
    input.action === "remove"
      ? input.packages.map(packageName)
      : input.packages;
  if (manager === "npm")
    return [input.action === "add" ? "install" : "uninstall", ...packages];
  return [input.action, ...packages];
}

function packageName(value: string) {
  const separator = value.lastIndexOf("@");
  return separator > 0 ? value.slice(0, separator) : value;
}

async function snapshotDependencyFiles(
  files: WorkspaceFiles,
  snapshot: WorkspaceSnapshot,
) {
  return Promise.all(
    dependencyPaths(snapshot.files).map(async (path) => {
      const file = await optionalFile(files, path);
      return {
        after: null,
        before: file?.content ?? null,
        mode: file?.mode,
        path,
      } satisfies LightFileMutation;
    }),
  );
}

function dependencyPaths(paths: string[]) {
  const manifests = paths.filter((path) => path.endsWith("package.json"));
  const directories = new Set(manifests.map((path) => dirname(path)));
  const lockfiles = [
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
  ];
  return [
    ...new Set([
      ...manifests,
      ...[...directories].flatMap((directory) =>
        lockfiles.map((file) =>
          directory === "." ? file : `${directory}/${file}`,
        ),
      ),
    ]),
  ].sort();
}

async function changedDependencyPaths(
  files: WorkspaceFiles,
  before: LightFileMutation[],
) {
  const changed: string[] = [];
  for (const mutation of before) {
    const current = await optionalFile(files, mutation.path);
    if (!sameContent(mutation.before, current?.content ?? null))
      changed.push(mutation.path);
  }
  return changed;
}

function manifestPath(files: WorkspaceFiles, packagePath?: string) {
  if (!packagePath) return "package.json";
  const normalized = files.normalizePath(packagePath);
  return normalized.endsWith("package.json")
    ? normalized
    : `${normalized.replace(/\/$/u, "")}/package.json`;
}

async function optionalFile(files: WorkspaceFiles, path: string) {
  try {
    return await files.read(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function sameContent(left: Buffer | null, right: Buffer | null) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function processOutput(result: { stderr: string; stdout: string }) {
  return redactSecuritySecrets(`${result.stdout}\n${result.stderr}`.trim());
}

function dependencyFailureCategory(diagnostic: string) {
  return /(?:EAI_AGAIN|ECONN|ENET|ENOENT|EACCES|permission|network|PACKAGE_MANAGER_UNAVAILABLE)/iu.test(
    diagnostic,
  )
    ? ("environment" as const)
    : ("code" as const);
}

function firstDiagnostic(value: string) {
  return (
    value
      .split(/\r?\n/u)
      .find((line) => /(?:error|failed|fatal|ERR_)/iu.test(line))
      ?.slice(0, 2_000) ||
    value.slice(0, 2_000) ||
    "Dependency mutation failed."
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
