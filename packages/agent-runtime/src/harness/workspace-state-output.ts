import { recalculateHarnessUsage, type HarnessToolResult } from "./protocol.js";

export function compactWorkspaceStateResult(
  result: HarnessToolResult<unknown>,
  include?: string[],
): HarnessToolResult<unknown> {
  if (result.status !== "success") return result;
  return recalculateHarnessUsage({
    ...result,
    data: compactWorkspaceStateData(result.data, include),
  });
}

function compactWorkspaceStateData(value: unknown, include?: string[]) {
  const data = recordValue(value);
  const keys = include ?? defaultWorkspaceStateKeys;
  return Object.fromEntries(
    keys.flatMap((key) =>
      Object.hasOwn(data, key) ? [[key, compactSection(key, data)]] : [],
    ),
  );
}

function compactSection(key: string, data: Record<string, unknown>) {
  if (key === "capabilities")
    return compactCapabilities(data.capabilities, data.tree_summary);
  if (key === "task_projection")
    return compactTaskProjection(data.task_projection);
  if (key === "tree_summary") return compactTreeSummary(data.tree_summary);
  if (key === "changes") return arrayValue(data.changes).slice(0, 3);
  if (key === "task_catalog") return arrayValue(data.task_catalog).slice(0, 5);
  return data[key];
}

function compactCapabilities(value: unknown, treeSummary: unknown) {
  const capabilities = recordValue(value);
  const semantic = recordValue(capabilities.semantic_workspace);
  const execution = recordValue(capabilities.execution);
  return {
    languages: compactLanguages(semantic.language_capabilities, treeSummary),
    dependency_mutation: compactMutation(execution.dependency_mutation),
    run_task: execution.run_task,
    network: execution.network,
  };
}

function compactLanguages(value: unknown, treeSummary: unknown) {
  const present = presentLanguages(treeSummary);
  const grouped = new Map<string, Record<string, unknown>>();
  for (const candidate of arrayValue(value).map(recordValue)) {
    const language = stringValue(candidate.languageId);
    if (!language || (present.size && !present.has(language))) continue;
    const current = grouped.get(language) ?? languageCapability(candidate);
    current.extensions = [
      ...arrayValue(current.extensions),
      ...arrayValue(candidate.extensions),
    ];
    grouped.set(language, current);
  }
  return [...grouped.values()];
}

function languageCapability(value: Record<string, unknown>) {
  return {
    language: value.languageId,
    extensions: [] as unknown[],
    level: value.level,
    edit_tool: value.recommendedEditTool,
  };
}

function presentLanguages(value: unknown) {
  const languages = arrayValue(recordValue(value).languages)
    .map((entry) => stringValue(recordValue(entry).language))
    .filter((entry): entry is string => Boolean(entry));
  return new Set(languages);
}

function compactTaskProjection(value: unknown) {
  const projection = recordValue(value);
  const inventory = recordValue(projection.dependency_inventory);
  return {
    relevant_targets: arrayValue(projection.relevant_targets).slice(0, 6),
    packages: arrayValue(projection.packages).slice(0, 6),
    dependency_inventory: compactDependencyInventory(inventory),
    executable_tasks: arrayValue(projection.executable_tasks).slice(0, 5),
  };
}

function compactDependencyInventory(value: Record<string, unknown>) {
  const lockfile = recordValue(value.lockfile);
  return {
    mutation: compactMutation(value.mutation),
    manifests: arrayValue(value.manifests).slice(0, 2).map(compactManifest),
    lockfile: {
      present: lockfile.present,
      path: lockfile.path,
      package_count: lockfile.package_count,
      packages: arrayValue(lockfile.packages).slice(0, 5),
      truncated: lockfile.truncated,
    },
  };
}

function compactManifest(value: unknown) {
  const manifest = recordValue(value);
  return {
    path: manifest.path,
    name: manifest.name,
    dependency_count: manifest.dependency_count,
    dependencies: arrayValue(manifest.dependencies).slice(0, 2),
  };
}

function compactMutation(value: unknown) {
  const mutation = recordValue(value);
  return {
    status: mutation.status,
    available: mutation.available,
    reason: reasonCode(mutation.reason),
    alternatives: mutation.alternatives,
  };
}

function reasonCode(value: unknown) {
  const reason = stringValue(value);
  return reason?.split(":", 1)[0];
}

function compactTreeSummary(value: unknown) {
  const tree = recordValue(value);
  return {
    file_count: tree.file_count,
    languages: tree.languages,
    top_level: arrayValue(tree.top_level).slice(0, 6),
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

const defaultWorkspaceStateKeys = [
  "source_revision",
  "task_contract",
  "capabilities",
  "task_projection",
  "tree_summary",
  "changes",
  "repository",
];
