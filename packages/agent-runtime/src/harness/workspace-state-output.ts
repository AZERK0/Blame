import {
  recalculateHarnessUsage,
  sha256,
  type HarnessToolResult,
} from "./protocol.js";

export type WorkspaceStatePageInput = {
  cursor?: string;
  pageSize?: number;
};

type WorkspacePage = {
  collection: "manifests" | "tasks";
  offset: number;
};

export function compactWorkspaceStateResult(
  result: HarnessToolResult<unknown>,
  include?: string[],
  pageInput: WorkspaceStatePageInput = {},
): HarnessToolResult<unknown> {
  if (result.status !== "success") return result;
  const sourceRevision = workspaceSourceRevision(result);
  const page = decodeCursor(pageInput.cursor, sourceRevision);
  if (pageInput.cursor && !page)
    return recalculateHarnessUsage({
      ...result,
      outcome: "unavailable",
      fatal: false,
      reason: "STALE_WORKSPACE_STATE_CURSOR",
      recommendation:
        "Call workspace_state without a cursor to obtain current pagination receipts.",
      data: {
        source_revision: recordValue(result.data).source_revision,
        pagination: {
          requested_cursor: pageInput.cursor,
          replacement: "workspace_state",
        },
      },
    });
  return recalculateHarnessUsage({
    ...result,
    data: compactWorkspaceStateData(
      result.data,
      include,
      sourceRevision,
      page,
      boundedPageSize(pageInput.pageSize),
    ),
  });
}

function compactWorkspaceStateData(
  value: unknown,
  include: string[] | undefined,
  sourceRevision: string,
  page: WorkspacePage | undefined,
  pageSize: number,
) {
  const data = recordValue(value);
  const keys = page
    ? [
        ...new Set([
          "source_revision",
          ...(include ?? defaultWorkspaceStateKeys),
        ]),
      ]
    : (include ?? defaultWorkspaceStateKeys);
  return Object.fromEntries(
    keys.flatMap((key) =>
      Object.hasOwn(data, key)
        ? [[key, compactSection(key, data, sourceRevision, page, pageSize)]]
        : [],
    ),
  );
}

function compactSection(
  key: string,
  data: Record<string, unknown>,
  sourceRevision: string,
  page: WorkspacePage | undefined,
  pageSize: number,
) {
  if (key === "capabilities")
    return compactCapabilities(data.capabilities, data.tree_summary);
  if (key === "task_projection")
    return compactTaskProjection(
      data.task_projection,
      sourceRevision,
      page,
      pageSize,
    );
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

function compactTaskProjection(
  value: unknown,
  sourceRevision: string,
  page: WorkspacePage | undefined,
  pageSize: number,
) {
  const projection = recordValue(value);
  const inventory = recordValue(projection.dependency_inventory);
  const manifests = arrayValue(inventory.manifests);
  const tasks = arrayValue(projection.executable_tasks);
  const targets = arrayValue(projection.relevant_targets);
  const relevantManifestPaths = relevantManifests(manifests, targets);
  const selectedManifests = page
    ? page.collection === "manifests"
      ? manifests
          .slice(page.offset, page.offset + pageSize)
          .map((manifest) => compactManifest(manifest, true))
      : []
    : manifests.map((manifest) =>
        relevantManifestPaths.has(stringValue(recordValue(manifest).path) ?? "")
          ? compactManifest(manifest)
          : manifestSummary(manifest, sourceRevision),
      );
  const selectedTasks = page
    ? page.collection === "tasks"
      ? tasks
          .slice(page.offset, page.offset + pageSize)
          .map((task) => referencedTask(task, sourceRevision))
      : []
    : relevantTasks(tasks, relevantManifestPaths).map((task) =>
        referencedTask(task, sourceRevision),
      );
  return {
    ...(page
      ? {}
      : {
          relevant_targets: targets.slice(0, 8),
          packages: arrayValue(projection.packages).map((entry) =>
            packageSummary(entry, sourceRevision),
          ),
          detected_frameworks: projection.detected_frameworks,
        }),
    dependency_inventory: compactDependencyInventory(
      inventory,
      selectedManifests,
    ),
    executable_tasks: selectedTasks,
    pagination: {
      mode: page?.collection ?? "relevant",
      manifests: pageReceipt(
        "manifests",
        manifests.length,
        page?.collection === "manifests" ? page.offset : 0,
        page?.collection === "manifests"
          ? selectedManifests.length
          : relevantManifestPaths.size,
        pageSize,
        sourceRevision,
        page?.collection === "manifests",
      ),
      tasks: pageReceipt(
        "tasks",
        tasks.length,
        page?.collection === "tasks" ? page.offset : 0,
        selectedTasks.length,
        pageSize,
        sourceRevision,
        page?.collection === "tasks",
      ),
      recommendation:
        "Use the short next_cursor to retrieve exhaustive manifest dependencies or task definitions only when needed.",
    },
  };
}

function compactDependencyInventory(
  value: Record<string, unknown>,
  manifests: unknown[],
) {
  const lockfile = recordValue(value.lockfile);
  return {
    mutation: compactMutation(value.mutation),
    manifests,
    lockfile: {
      present: lockfile.present,
      path: lockfile.path,
      package_count: lockfile.package_count,
      packages: arrayValue(lockfile.packages).slice(0, 5),
      truncated: lockfile.truncated,
    },
  };
}

function compactManifest(value: unknown, allScripts = false) {
  const manifest = recordValue(value);
  const scripts = arrayValue(manifest.scripts).map(recordValue);
  return {
    path: manifest.path,
    name: manifest.name,
    dependency_count: manifest.dependency_count,
    dependencies: arrayValue(manifest.dependencies),
    scripts: allScripts
      ? scripts
      : scripts.filter((script) => importantTaskKind(stringValue(script.name))),
  };
}

function manifestSummary(value: unknown, sourceRevision: string) {
  const manifest = recordValue(value);
  const path = stringValue(manifest.path) ?? "package.json";
  const scripts = arrayValue(manifest.scripts).map(recordValue);
  return {
    path,
    name: manifest.name,
    dependency_count: manifest.dependency_count,
    script_count: scripts.length,
    important_scripts: scripts
      .filter((script) => importantTaskKind(stringValue(script.name)))
      .map((script) => script.name),
    manifest_ref: workspaceStateRef("manifest", sourceRevision, path),
    detail: "paginated",
  };
}

function packageSummary(value: unknown, sourceRevision: string) {
  const entry = recordValue(value);
  const path = stringValue(entry.path) ?? "package.json";
  const scripts = arrayValue(entry.scripts).map(recordValue);
  return {
    path,
    name: entry.name,
    collection: entry.collection,
    script_count: scripts.length,
    important_scripts: scripts
      .filter((script) => importantTaskKind(stringValue(script.name)))
      .map((script) => script.name),
    manifest_ref: workspaceStateRef("manifest", sourceRevision, path),
  };
}

function referencedTask(value: unknown, sourceRevision: string) {
  const task = recordValue(value);
  const taskId = stringValue(task.task_id) ?? JSON.stringify(task);
  return {
    ...task,
    task_ref: workspaceStateRef("task", sourceRevision, taskId),
  };
}

function relevantManifests(manifests: unknown[], targets: unknown[]) {
  const paths = manifests
    .map((manifest) => stringValue(recordValue(manifest).path))
    .filter((path): path is string => Boolean(path));
  const selected = new Set<string>();
  if (paths.includes("package.json")) selected.add("package.json");
  for (const target of targets) {
    const targetPath = stringValue(recordValue(target).path);
    if (!targetPath) continue;
    const nearest = paths
      .filter((path) => {
        const directory = manifestDirectory(path);
        return (
          !directory ||
          targetPath === directory ||
          targetPath.startsWith(`${directory}/`)
        );
      })
      .sort(
        (left, right) =>
          manifestDirectory(right).length - manifestDirectory(left).length,
      )[0];
    if (nearest) selected.add(nearest);
    if (selected.size >= 4) break;
  }
  if (!selected.size && paths[0]) selected.add(paths[0]);
  return selected;
}

function relevantTasks(tasks: unknown[], manifestPaths: Set<string>) {
  const directories = [...manifestPaths].map(manifestDirectory);
  const scopedDirectories = directories.filter(Boolean);
  const scored = tasks.map((task, index) => {
    const value = recordValue(task);
    const cwd = stringValue(value.cwd) ?? ".";
    const kind = stringValue(value.kind);
    const relevant = scopedDirectories.length
      ? scopedDirectories.some(
          (directory) => cwd === directory || cwd.startsWith(`${directory}/`),
        )
      : cwd === "." || cwd === "";
    return {
      index,
      relevant,
      important: importantTaskKind(kind),
      task,
    };
  });
  return scored
    .sort(
      (left, right) =>
        Number(right.relevant) - Number(left.relevant) ||
        Number(right.important) - Number(left.important) ||
        left.index - right.index,
    )
    .slice(0, 12)
    .map(({ task }) => task);
}

function pageReceipt(
  collection: WorkspacePage["collection"],
  total: number,
  offset: number,
  returned: number,
  pageSize: number,
  sourceRevision: string,
  activePage: boolean,
) {
  const nextOffset = activePage ? offset + returned : 0;
  return {
    total,
    returned,
    offset: activePage ? offset : undefined,
    next_cursor:
      nextOffset < total
        ? encodeCursor(collection, sourceRevision, nextOffset)
        : undefined,
    page_size: pageSize,
  };
}

function encodeCursor(
  collection: WorkspacePage["collection"],
  sourceRevision: string,
  offset: number,
) {
  const kind = collection === "manifests" ? "m" : "t";
  return `ws${kind}_${sha256(sourceRevision).slice(0, 10)}_${offset}`;
}

function decodeCursor(
  cursor: string | undefined,
  sourceRevision: string,
): WorkspacePage | undefined {
  if (!cursor) return undefined;
  const match = /^ws([mt])_([a-f0-9]{10})_(\d+)$/u.exec(cursor);
  if (!match || match[2] !== sha256(sourceRevision).slice(0, 10))
    return undefined;
  return {
    collection: match[1] === "m" ? "manifests" : "tasks",
    offset: Number(match[3]),
  };
}

function workspaceStateRef(
  kind: "manifest" | "task",
  sourceRevision: string,
  identity: string,
) {
  return `workspace-state://${kind}/${sha256(`${sourceRevision}\0${identity}`).slice(0, 20)}`;
}

function workspaceSourceRevision(result: HarnessToolResult<unknown>) {
  const data = recordValue(result.status === "success" ? result.data : {});
  return (
    stringValue(recordValue(data.source_revision).source_revision_id) ??
    (result.status === "success"
      ? stringValue(result.subject_revision.source_revision_id)
      : undefined) ??
    "unversioned"
  );
}

function boundedPageSize(value: number | undefined) {
  return Math.max(1, Math.min(25, Math.floor(value ?? 5)));
}

function importantTaskKind(value: string | undefined) {
  return Boolean(
    value && /^(?:build|check|lint|test|typecheck)$/iu.test(value),
  );
}

function manifestDirectory(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function compactMutation(value: unknown) {
  const mutation = recordValue(value);
  return {
    status: mutation.status,
    available: mutation.available,
    package_manager: mutation.package_manager,
    package_manager_version: mutation.package_manager_version,
    cache_available: mutation.cache_available,
    network_policy: mutation.network_policy,
    registry_policy: mutation.registry_policy,
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
