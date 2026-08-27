import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ArtifactStore } from "./artifact-store.js";
import { ChangeService } from "./change-service.js";
import { stableJson } from "./change-store.js";
import { dependencyCacheRoot } from "./dependency-cache.js";
import { sha256 } from "./protocol.js";
import {
  dependencyMutationInputSchema,
  type DependencyMutationInput,
  type TaskCatalogItem,
} from "./schemas.js";
import { readTaskCatalog } from "./task-catalog.js";
import {
  SandboxedTaskExecutor,
  type TaskExecutionInput,
  type TaskExecutor,
} from "./task-executor.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";
import { WorkspaceOverlay } from "./workspace-overlay.js";

const managerLockfiles = {
  bun: new Set(["bun.lock", "bun.lockb"]),
  npm: new Set(["package-lock.json"]),
  pnpm: new Set(["pnpm-lock.yaml"]),
  yarn: new Set(["yarn.lock"]),
} as const;

export class DependencyMutationService {
  private readonly changes: ChangeService;
  private readonly executor: TaskExecutor;
  private readonly files: WorkspaceFiles;

  constructor(
    files: WorkspaceFiles,
    artifacts: ArtifactStore,
    executor?: TaskExecutor,
  ) {
    this.files = files;
    this.changes = new ChangeService(files, artifacts);
    this.executor = executor ?? new SandboxedTaskExecutor();
  }

  async mutate(
    input: DependencyMutationInput,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    input = dependencyMutationInputSchema.parse(input);
    const packagePath = this.files.normalizePath(input.package_path);
    if (basename(packagePath) !== "package.json")
      throw new Error("INVALID_INPUT:package_path must identify package.json.");
    const task = await dependencyTask(this.files.root, snapshot.files);
    const overlay = await WorkspaceOverlay.materialize(
      this.files,
      snapshot,
      signal,
    );
    try {
      return await this.mutateOverlay(
        input,
        snapshot,
        packagePath,
        overlay,
        task,
        signal,
      );
    } finally {
      await overlay.cleanup();
    }
  }

  private async mutateOverlay(
    input: DependencyMutationInput,
    snapshot: WorkspaceSnapshot,
    packagePath: string,
    overlay: WorkspaceOverlay,
    task: TaskCatalogItem,
    signal?: AbortSignal,
  ) {
    const changed = await updateManifest(overlay.workspace, packagePath, input);
    if (!changed) return noChangeReceipt(snapshot, packagePath, task);
    const execution = await this.executeInstall(
      input,
      snapshot,
      overlay,
      task,
      signal,
    );
    const effects = await overlay.effects(signal);
    assertDependencyEffects(effects, packagePath, task.package_manager);
    const receipt = await this.commitEffects(input, snapshot, effects.changes);
    return mutationReceipt(input, packagePath, task, execution, receipt);
  }

  private async commitEffects(
    input: DependencyMutationInput,
    snapshot: WorkspaceSnapshot,
    changes: Awaited<ReturnType<WorkspaceOverlay["effects"]>>["changes"],
  ) {
    const digest = sha256(stableJson(input));
    const idempotency = input.idempotency_key ?? digest;
    const proposal = await this.changes.proposeRunEffects({
      base_source_revision_id: snapshot.revision.source_revision_id,
      idempotency_key: `dependency-mutation:${idempotency}`,
      input_digest: digest,
      changes,
    });
    return this.changes.commitResolved({
      action: "commit_proposal",
      proposal_ref: proposal.proposal_ref,
      expected_base_source_revision_id: snapshot.revision.source_revision_id,
      idempotency_key: `dependency-commit:${idempotency}`,
    });
  }

  private async executeInstall(
    input: DependencyMutationInput,
    snapshot: WorkspaceSnapshot,
    overlay: WorkspaceOverlay,
    task: TaskCatalogItem,
    signal?: AbortSignal,
  ) {
    const executionInput = await dependencyExecutionInput({
      input,
      snapshot,
      overlay,
      task,
      workspaceRoot: this.files.root,
      signal,
    });
    const health = await this.executor.healthCheck?.(executionInput);
    if (health && !health.available)
      throw new Error(
        `EXECUTION_ERROR:${health.stderr ?? "Executor unavailable."}`,
      );
    const result = await this.executor.execute(executionInput);
    if (result.status !== "passed")
      throw new Error(
        `EXECUTION_ERROR:Dependency lockfile update ${result.status}: ${result.stderr.slice(0, 1_000)}`,
      );
    return result;
  }
}

async function dependencyExecutionInput(input: {
  input: DependencyMutationInput;
  snapshot: WorkspaceSnapshot;
  overlay: WorkspaceOverlay;
  task: TaskCatalogItem;
  workspaceRoot: string;
  signal?: AbortSignal;
}): Promise<TaskExecutionInput> {
  return {
    executable: input.task.package_manager,
    args: lockfileArguments(input.task),
    cwd: input.overlay.workspace,
    overlayRoot: input.overlay.workspace,
    canonicalWorkspaceRoot: input.workspaceRoot,
    readonlyRoots: input.overlay.readonlyInputs,
    dependencyCacheRoot: await dependencyCacheRoot(
      input.workspaceRoot,
      input.snapshot.files,
      input.task,
    ),
    packageManager: input.task.package_manager,
    packageManagerCompatibility: "pnpm_same_major",
    packageManagerVersion: input.task.package_manager_version,
    timeoutMs: input.input.timeout_ms,
    outputBytes: 256 * 1024,
    signal: input.signal,
    network: input.input.network,
  };
}

async function dependencyTask(root: string, files: string[]) {
  const catalog = await readTaskCatalog(root, files);
  const task = catalog.find((candidate) => candidate.kind === "dependencies");
  if (!task)
    throw new Error("UNSUPPORTED_CAPABILITY:No package.json was found.");
  return task;
}

async function updateManifest(
  overlayRoot: string,
  packagePath: string,
  input: DependencyMutationInput,
) {
  const path = join(overlayRoot, packagePath);
  const source = await readFile(path, "utf8");
  const manifest = JSON.parse(source) as Record<string, unknown>;
  const before = stableJson(manifest);
  for (const operation of input.operations)
    applyDependencyOperation(manifest, operation);
  if (stableJson(manifest) === before) return false;
  const indentation = source.match(/\n([ \t]+)"/u)?.[1] ?? "  ";
  await writeFile(path, `${JSON.stringify(manifest, null, indentation)}\n`);
  return true;
}

function applyDependencyOperation(
  manifest: Record<string, unknown>,
  operation: DependencyMutationInput["operations"][number],
) {
  if (operation.action === "add") {
    const dependencies = dependencyRecord(manifest, operation.dependency_type)!;
    dependencies[operation.name] = operation.version;
    manifest[operation.dependency_type] = sortRecord(dependencies);
    return;
  }
  const types = operation.dependency_type
    ? [operation.dependency_type]
    : [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ];
  for (const type of types) {
    const dependencies = dependencyRecord(manifest, type, false);
    if (!dependencies) continue;
    delete dependencies[operation.name];
    if (Object.keys(dependencies).length)
      manifest[type] = sortRecord(dependencies);
    else delete manifest[type];
  }
}

function dependencyRecord(
  manifest: Record<string, unknown>,
  type: string,
  create = true,
) {
  const current = manifest[type];
  if (current && typeof current === "object" && !Array.isArray(current))
    return { ...(current as Record<string, string>) };
  return create ? {} : undefined;
}

function sortRecord(value: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function lockfileArguments(task: TaskCatalogItem) {
  if (task.package_manager === "pnpm")
    return ["install", "--lockfile-only", "--prefer-offline"];
  if (task.package_manager === "yarn")
    return task.package_manager_version?.startsWith("1.")
      ? [
          "install",
          "--ignore-scripts",
          "--modules-folder",
          ".blame/harness/yarn-modules",
        ]
      : ["install", "--mode=update-lockfile"];
  if (task.package_manager === "bun") return ["install", "--lockfile-only"];
  return [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ];
}

function assertDependencyEffects(
  effects: Awaited<ReturnType<WorkspaceOverlay["effects"]>>,
  packagePath: string,
  manager: TaskCatalogItem["package_manager"],
) {
  if (effects.uncaptured_reason)
    throw new Error(`IO_ERROR:${effects.uncaptured_reason}`);
  const lockfileChanged = [
    ...effects.created,
    ...effects.modified,
    ...effects.deleted,
  ].some((path) => managerLockfiles[manager].has(basename(path)));
  if (!lockfileChanged)
    throw new Error(
      "EXECUTION_ERROR:The package manager did not produce a lockfile change.",
    );
  const unexpected = [
    ...effects.created,
    ...effects.modified,
    ...effects.deleted,
  ].filter(
    (path) =>
      path !== packagePath && !managerLockfiles[manager].has(basename(path)),
  );
  if (unexpected.length)
    throw new Error(
      `POLICY_DENIED:Dependency mutation changed unexpected files: ${unexpected.join(", ")}`,
    );
}

function mutationReceipt(
  input: DependencyMutationInput,
  packagePath: string,
  task: TaskCatalogItem,
  execution: Awaited<ReturnType<TaskExecutor["execute"]>>,
  receipt: Awaited<ReturnType<ChangeService["commitResolved"]>>,
) {
  return {
    status: "applied" as const,
    package_path: packagePath,
    operation_count: input.operations.length,
    changed_files: receipt.changed_files,
    source_revision_id: receipt.source_revision.source_revision_id,
    package_manager: task.package_manager,
    package_manager_version:
      execution.packageManagerResolution?.resolvedVersion,
    network: {
      requested: input.network,
      enforced: execution.isolation !== "worktree",
    },
    change_set_ref: receipt.change_set_ref,
  };
}

function noChangeReceipt(
  snapshot: WorkspaceSnapshot,
  packagePath: string,
  task: TaskCatalogItem,
) {
  return {
    status: "no_change" as const,
    package_path: packagePath,
    operation_count: 0,
    changed_files: [],
    source_revision_id: snapshot.revision.source_revision_id,
    package_manager: task.package_manager,
  };
}
