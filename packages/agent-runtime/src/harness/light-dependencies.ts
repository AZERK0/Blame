import { dirname } from "node:path";
import { execa } from "execa";
import { redactSecuritySecrets } from "../security-secret-redaction.js";
import {
  resolvePackageManager,
  type PackageManagerName,
} from "./package-manager-runtime.js";
import { LightCommitService, type LightFileMutation } from "./light-commit.js";
import type { LightRunTaskInput } from "./light-contracts.js";
import { boundedDiagnostic } from "./light-diagnostic.js";
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
    const manifestContent = (await this.files.read(manifest)).content;
    const before = await snapshotDependencyFiles(this.files, snapshot);
    try {
      const effectiveInput = alignedDependencyInput(input, manifestContent);
      const execution = await this.execute(
        effectiveInput,
        manifest,
        snapshot,
        signal,
      );
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
      all: true,
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
      message: boundedDiagnostic(diagnostic, "Dependency mutation failed."),
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

function alignedDependencyInput(input: DependencyInput, manifest: Buffer) {
  if (input.action !== "add") return input;
  try {
    const value = JSON.parse(manifest.toString("utf8")) as unknown;
    return {
      ...input,
      packages: alignDependencyPackages(input.packages, value),
    };
  } catch {
    return input;
  }
}

export function alignDependencyPackages(packages: string[], manifest: unknown) {
  const version = prismaFamilyVersion(manifest);
  if (!version) return packages;
  return packages.map((value) =>
    prismaFamilyPackage(value) && !explicitPackageVersion(value)
      ? `${value}@${version}`
      : value,
  );
}

function prismaFamilyVersion(manifest: unknown) {
  const value = record(manifest);
  for (const packageName of ["@prisma/client", "prisma"])
    for (const section of dependencyManifestSections) {
      const declared = record(value[section])[packageName];
      const version = semanticVersion(declared);
      if (version) return version;
    }
  return undefined;
}

function semanticVersion(value: unknown) {
  return typeof value === "string"
    ? value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u)?.[0]
    : undefined;
}

function prismaFamilyPackage(value: string) {
  return value === "prisma" || value.startsWith("@prisma/");
}

function explicitPackageVersion(value: string) {
  return value.lastIndexOf("@") > 0;
}

export const dependencyManifestSections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

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

function processOutput(result: {
  all?: string;
  stderr: string;
  stdout: string;
}) {
  return redactSecuritySecrets(
    (result.all ?? `${result.stdout}\n${result.stderr}`).trim(),
  );
}

function dependencyFailureCategory(diagnostic: string) {
  return /(?:EAI_AGAIN|ECONN|ENET|ENOENT|EACCES|permission|network|PACKAGE_MANAGER_UNAVAILABLE)/iu.test(
    diagnostic,
  )
    ? ("environment" as const)
    : ("code" as const);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
