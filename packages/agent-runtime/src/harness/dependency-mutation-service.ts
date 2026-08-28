import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ArtifactStore } from "./artifact-store.js";
import { ChangeService } from "./change-service.js";
import { stableJson } from "./change-store.js";
import {
  dependencyCachePopulated,
  dependencyCacheRoot,
} from "./dependency-cache.js";
import { DependencyCapabilityCircuit } from "./dependency-capability-circuit.js";
import { sha256 } from "./protocol.js";
import {
  dependencyMutationInputSchema,
  type DependencyMutationInput,
  type TaskCatalogItem,
} from "./schemas.js";
import { readTaskCatalog } from "./task-catalog.js";
import {
  automaticDependencyNetworkPolicy,
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

export type DependencyMutationCapability = {
  alternatives: Array<
    | "reuse_existing_dependency"
    | "implement_without_dependency"
    | "report_blocked"
  >;
  applied: false;
  available: boolean;
  cache_available: boolean;
  capability: "dependency_mutation";
  circuit_open: boolean;
  circuit_opened?: boolean;
  environment_fingerprint: string;
  install_available: boolean;
  network_policy: "deny" | "project_allowlist";
  package_manager: string;
  package_manager_version?: string;
  registry_policy: "configured_only";
  reason?: string;
  retryable: false;
  status: "available" | "unavailable";
};

type DependencyCapabilityContext = {
  cacheAvailable: boolean;
  cacheRoot: string;
  declared?: Awaited<
    ReturnType<NonNullable<TaskExecutor["dependencyCapability"]>>
  >;
  environmentFingerprint: string;
  executorUnavailableReason?: string;
  networkPolicy: "deny" | "project_allowlist";
  task: TaskCatalogItem;
};

export class DependencyMutationService {
  private readonly changes: ChangeService;
  private readonly circuit: DependencyCapabilityCircuit;
  private readonly executor: TaskExecutor;
  private readonly files: WorkspaceFiles;

  constructor(
    files: WorkspaceFiles,
    artifacts: ArtifactStore,
    executor?: TaskExecutor,
    sessionId = "unscoped-session",
  ) {
    this.files = files;
    this.changes = new ChangeService(files, artifacts);
    this.executor = executor ?? new SandboxedTaskExecutor();
    this.circuit = new DependencyCapabilityCircuit(files.root, sessionId);
  }

  async capability(snapshot: WorkspaceSnapshot) {
    const task = await dependencyTask(this.files.root, snapshot.files).catch(
      () => undefined,
    );
    if (!task)
      return unavailableCapability(
        { package_manager: "npm" },
        sha256("no-package-manifest"),
        "DEPENDENCY_EXECUTOR_UNAVAILABLE:No package.json was found.",
        false,
        false,
      );
    const context = await this.capabilityContext(snapshot, task);
    const open = await this.circuit.status(context.environmentFingerprint);
    if (open)
      return unavailableCapability(
        task,
        context.environmentFingerprint,
        open.reason,
        true,
        context.cacheAvailable,
      );
    return this.freshCapability(context);
  }

  private async capabilityContext(
    snapshot: WorkspaceSnapshot,
    task: TaskCatalogItem,
  ): Promise<DependencyCapabilityContext> {
    const executor = await executorCapability(this.executor);
    const networkPolicy = selectedNetworkPolicy(executor.declared);
    const cacheRoot = await dependencyCacheRoot(
      this.files.root,
      snapshot.files,
      task,
    );
    const cacheAvailable = await dependencyCachePopulated(cacheRoot);
    const environmentFingerprint = sha256(
      stableJson({ cacheAvailable, executor, networkPolicy, task }),
    );
    return {
      cacheAvailable,
      cacheRoot,
      declared: executor.declared,
      environmentFingerprint,
      executorUnavailableReason: executor.reason,
      networkPolicy,
      task,
    };
  }

  private async freshCapability(context: DependencyCapabilityContext) {
    const unavailableReason = immediateUnavailableReason(context);
    if (unavailableReason)
      return unavailableCapability(
        context.task,
        context.environmentFingerprint,
        unavailableReason,
        false,
        context.cacheAvailable,
      );
    const healthy = await this.executorHealth(
      context.task,
      context.cacheRoot,
      context.networkPolicy,
    );
    if (!healthy.available)
      return unavailableCapability(
        context.task,
        context.environmentFingerprint,
        healthy.reason,
        false,
        context.cacheAvailable,
      );
    return accessibleCapability(context);
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
    if (!snapshot.files.includes(packagePath))
      throw new Error(
        `TARGET_NOT_FOUND:${packagePath} does not exist in the current workspace revision.`,
      );
    await this.files.read(packagePath);
    const dependencies = await availableDependencies(
      this.files.root,
      packagePath,
    );
    const capability = await this.capability(snapshot);
    if (!capability.available)
      return this.unavailableMutation(capability, dependencies);
    return this.availableMutation(
      input,
      snapshot,
      packagePath,
      capability,
      dependencies,
      signal,
    );
  }

  private async availableMutation(
    input: DependencyMutationInput,
    snapshot: WorkspaceSnapshot,
    packagePath: string,
    capability: DependencyMutationCapability,
    dependencies: AvailableDependency[],
    signal?: AbortSignal,
  ) {
    const task = await dependencyTask(this.files.root, snapshot.files);
    const overlay = await WorkspaceOverlay.materialize(
      this.files,
      snapshot,
      signal,
    );
    try {
      return await this.mutatePreparedOverlay(
        input,
        snapshot,
        packagePath,
        overlay,
        task,
        capability.network_policy,
        dependencies,
        signal,
      );
    } finally {
      await overlay.cleanup();
    }
  }

  private async mutatePreparedOverlay(
    input: DependencyMutationInput,
    snapshot: WorkspaceSnapshot,
    packagePath: string,
    overlay: WorkspaceOverlay,
    task: TaskCatalogItem,
    networkPolicy: "deny" | "project_allowlist",
    dependencies: AvailableDependency[],
    signal?: AbortSignal,
  ) {
    try {
      return await this.mutateOverlay(
        input,
        snapshot,
        packagePath,
        overlay,
        task,
        networkPolicy,
        signal,
      );
    } catch (error) {
      if (!dependencyCapabilityFailure(error)) throw error;
      return this.capabilityFailureReceipt(snapshot, error, dependencies);
    }
  }

  private async capabilityFailureReceipt(
    snapshot: WorkspaceSnapshot,
    error: unknown,
    dependencies: AvailableDependency[],
  ) {
    const unavailable = await this.openUnavailable(
      snapshot,
      errorMessage(error),
    );
    return unavailableReceipt(unavailable, dependencies);
  }

  private async unavailableMutation(
    capability: DependencyMutationCapability,
    dependencies: AvailableDependency[],
  ) {
    const unavailable = await this.openCapability(
      capability,
      capability.reason ?? "DEPENDENCY_EXECUTOR_UNAVAILABLE",
    );
    return unavailableReceipt(unavailable, dependencies);
  }

  async openUnavailable(snapshot: WorkspaceSnapshot, reason: string) {
    const capability = await this.capability(snapshot);
    return this.openCapability(capability, reason);
  }

  private async openCapability(
    capability: DependencyMutationCapability,
    reason: string,
  ) {
    await this.circuit.open(capability.environment_fingerprint, reason);
    return {
      ...unavailableCapability(
        {
          package_manager:
            capability.package_manager as TaskCatalogItem["package_manager"],
          ...(capability.package_manager_version
            ? { package_manager_version: capability.package_manager_version }
            : {}),
        },
        capability.environment_fingerprint,
        reason,
        true,
        capability.cache_available,
      ),
      circuit_opened: !capability.circuit_open,
    };
  }

  isCapabilityFailure(value: string) {
    return dependencyCapabilityFailure(value);
  }

  private async mutateOverlay(
    input: DependencyMutationInput,
    snapshot: WorkspaceSnapshot,
    packagePath: string,
    overlay: WorkspaceOverlay,
    task: TaskCatalogItem,
    networkPolicy: "deny" | "project_allowlist",
    signal?: AbortSignal,
  ) {
    const changed = await updateManifest(overlay.workspace, packagePath, input);
    if (!changed) return noChangeReceipt(snapshot, packagePath, task);
    const execution = await this.executeInstall(
      input,
      snapshot,
      overlay,
      task,
      networkPolicy,
      signal,
    );
    const effects = await overlay.effects(signal);
    assertDependencyEffects(effects, packagePath, task.package_manager);
    const receipt = await this.commitEffects(input, snapshot, effects.changes);
    return mutationReceipt(
      input,
      packagePath,
      task,
      execution,
      receipt,
      networkPolicy,
    );
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
    networkPolicy: "deny" | "project_allowlist",
    signal?: AbortSignal,
  ) {
    const executionInput = await dependencyExecutionInput({
      input,
      snapshot,
      overlay,
      task,
      networkPolicy,
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

  private async executorHealth(
    task: TaskCatalogItem,
    cacheRoot: string,
    network: "deny" | "project_allowlist",
  ) {
    if (!this.executor.healthCheck) return { available: true as const };
    const health = await this.executor.healthCheck({
      executable: task.package_manager,
      args: [],
      cwd: this.files.root,
      overlayRoot: this.files.root,
      canonicalWorkspaceRoot: this.files.root,
      dependencyCacheRoot: cacheRoot,
      packageManager: task.package_manager,
      packageManagerCompatibility: "pnpm_same_major",
      packageManagerVersion: task.package_manager_version,
      timeoutMs: 5_000,
      outputBytes: 4_096,
      network,
    });
    return health.available
      ? { available: true as const }
      : {
          available: false as const,
          reason: health.stderr ?? "DEPENDENCY_EXECUTOR_UNAVAILABLE",
        };
  }
}

async function dependencyExecutionInput(input: {
  input: DependencyMutationInput;
  snapshot: WorkspaceSnapshot;
  overlay: WorkspaceOverlay;
  task: TaskCatalogItem;
  networkPolicy: "deny" | "project_allowlist";
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
    network: input.networkPolicy,
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
    return [
      "install",
      "--lockfile-only",
      "--prefer-offline",
      "--ignore-scripts",
    ];
  if (task.package_manager === "yarn")
    return task.package_manager_version?.startsWith("1.")
      ? [
          "install",
          "--ignore-scripts",
          "--modules-folder",
          ".blame/harness/yarn-modules",
        ]
      : ["install", "--mode=update-lockfile"];
  if (task.package_manager === "bun")
    return ["install", "--lockfile-only", "--ignore-scripts"];
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
  networkPolicy: "deny" | "project_allowlist",
) {
  return {
    status: "applied" as const,
    package_path: packagePath,
    operation_count: input.operations.length,
    changed_files: receipt.changed_files,
    source_revision_id: receipt.source_revision.source_revision_id,
    package_manager: task.package_manager,
    registry_policy: "configured_only",
    package_manager_version:
      execution.packageManagerResolution?.resolvedVersion,
    network: {
      selected: networkPolicy,
      enforced: execution.isolation !== "worktree",
    },
    change_set_ref: receipt.change_set_ref,
  };
}

function selectedNetworkPolicy(
  declared:
    | Awaited<ReturnType<NonNullable<TaskExecutor["dependencyCapability"]>>>
    | undefined,
) {
  if (declared?.network === "managed_allowlist")
    return "project_allowlist" as const;
  if (declared?.network === "cache_only") return "deny" as const;
  return automaticDependencyNetworkPolicy();
}

async function executorCapability(executor: TaskExecutor) {
  try {
    const [isolation, declared] = await Promise.all([
      executor.capability(),
      executor.dependencyCapability?.(),
    ]);
    return { declared, isolation };
  } catch (error) {
    return {
      declared: undefined,
      isolation: "unavailable" as const,
      reason: errorMessage(error),
    };
  }
}

function immediateUnavailableReason(context: DependencyCapabilityContext) {
  if (context.executorUnavailableReason)
    return context.executorUnavailableReason;
  if (context.declared && !context.declared.available)
    return context.declared.reason ?? "DEPENDENCY_EXECUTOR_UNAVAILABLE";
  return undefined;
}

function accessibleCapability(context: DependencyCapabilityContext) {
  const available =
    context.networkPolicy === "project_allowlist" || context.cacheAvailable;
  if (available)
    return availableCapability(
      context.task,
      context.environmentFingerprint,
      context.networkPolicy,
      context.cacheAvailable,
    );
  return unavailableCapability(
    context.task,
    context.environmentFingerprint,
    "DEPENDENCY_EXECUTOR_UNAVAILABLE:No managed dependency network or prepared lockfile cache is available.",
    false,
    context.cacheAvailable,
  );
}

function availableCapability(
  task: Pick<TaskCatalogItem, "package_manager" | "package_manager_version">,
  environmentFingerprint: string,
  networkPolicy: "deny" | "project_allowlist",
  cacheAvailable: boolean,
): DependencyMutationCapability {
  return {
    alternatives: [...dependencyAlternatives],
    applied: false,
    available: true,
    cache_available: cacheAvailable,
    capability: "dependency_mutation",
    circuit_open: false,
    environment_fingerprint: environmentFingerprint,
    install_available: true,
    network_policy: networkPolicy,
    package_manager: task.package_manager,
    registry_policy: "configured_only",
    ...(task.package_manager_version
      ? { package_manager_version: task.package_manager_version }
      : {}),
    retryable: false,
    status: "available",
  };
}

function unavailableCapability(
  task: Pick<TaskCatalogItem, "package_manager" | "package_manager_version">,
  environmentFingerprint: string,
  reason: string,
  circuitOpen: boolean,
  cacheAvailable: boolean,
): DependencyMutationCapability {
  return {
    alternatives: [...dependencyAlternatives],
    applied: false,
    available: false,
    cache_available: cacheAvailable,
    capability: "dependency_mutation",
    circuit_open: circuitOpen,
    environment_fingerprint: environmentFingerprint,
    install_available: false,
    network_policy: "deny",
    package_manager: task.package_manager,
    registry_policy: "configured_only",
    ...(task.package_manager_version
      ? { package_manager_version: task.package_manager_version }
      : {}),
    reason: normalizeCapabilityReason(reason),
    retryable: false,
    status: "unavailable",
  };
}

function unavailableReceipt(
  capability: DependencyMutationCapability,
  dependencies: AvailableDependency[],
) {
  return {
    reason:
      capability.reason ??
      "DEPENDENCY_EXECUTOR_UNAVAILABLE:Dependency mutation is unavailable.",
    dependencies_already_available: dependencies,
    strategies: [...dependencyAlternatives],
  };
}

type AvailableDependency = {
  name: string;
  type: string;
  version: string;
};

async function availableDependencies(root: string, packagePath: string) {
  const manifest = JSON.parse(
    await readFile(join(root, packagePath), "utf8"),
  ) as Record<string, unknown>;
  return [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ].flatMap((type) => {
    const current = manifest[type];
    if (!current || typeof current !== "object" || Array.isArray(current))
      return [];
    return Object.entries(current as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      )
      .map(([name, version]) => ({ name, type, version }));
  });
}

function normalizeCapabilityReason(value: string) {
  if (/^DEPENDENCY_EXECUTOR_UNAVAILABLE:/u.test(value)) return value;
  return `DEPENDENCY_EXECUTOR_UNAVAILABLE:${value}`;
}

function dependencyCapabilityFailure(value: unknown) {
  return /allowlist|corepack|econnrefused|enotfound|package_manager_unavailable|package manager unavailable|executor unavailable|executable unavailable|dependency_executor_unavailable|blame_project_allowlist_proxy/iu.test(
    errorMessage(value),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const dependencyAlternatives = [
  "reuse_existing_dependency",
  "implement_without_dependency",
  "report_blocked",
] as const;

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
