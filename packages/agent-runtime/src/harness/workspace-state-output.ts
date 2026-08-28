import {
  boundHarnessResult,
  recalculateHarnessUsage,
  sha256,
  type HarnessToolResult,
} from "./protocol.js";

export type WorkspaceStatePageInput = {
  cursor?: string;
  pageSize?: number;
};

type WorkspacePage =
  | {
      collection: "manifests" | "tasks";
      offset: number;
    }
  | {
      collection: "dependencies";
      manifestIndex: number;
      offset: number;
    };

const defaultWorkspaceStateMaximumTokens = 8_000;
const maximumInlineManifestDependencyBytes = 6_000;

export function compactWorkspaceStateResult(
  result: HarnessToolResult<unknown>,
  include?: string[],
  pageInput: WorkspaceStatePageInput = {},
  maximumTokens = defaultWorkspaceStateMaximumTokens,
): HarnessToolResult<unknown> {
  if (result.status !== "success")
    return boundHarnessResult(result, boundedMaximumTokens(maximumTokens));
  const sourceRevision = workspaceSourceRevision(result);
  const page = decodeCursor(pageInput.cursor, sourceRevision);
  if (pageInput.cursor && !page)
    return boundHarnessResult(
      recalculateHarnessUsage({
        ...result,
        outcome: "completed",
        fatal: false,
        reason: "CURSOR_RESET",
        recommendation:
          "Use the returned current state. For another page, pass only an exact next_cursor emitted by this response.",
        data: {
          ...compactWorkspaceStateData(
            result.data,
            include,
            sourceRevision,
            undefined,
            boundedPageSize(pageInput.pageSize),
          ),
          pagination_recovery: {
            status: "cursor_reset",
            requested_cursor: pageInput.cursor,
            reason: "STALE_WORKSPACE_STATE_CURSOR",
          },
        },
      }),
      boundedMaximumTokens(maximumTokens),
    );
  return boundHarnessResult(
    recalculateHarnessUsage({
      ...result,
      data: compactWorkspaceStateData(
        result.data,
        include,
        sourceRevision,
        page,
        boundedPageSize(pageInput.pageSize),
      ),
    }),
    boundedMaximumTokens(maximumTokens),
  );
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
          .map((manifest, index) =>
            compactManifest(
              manifest,
              true,
              sourceRevision,
              page.offset + index,
            ),
          )
      : page.collection === "dependencies"
        ? dependencyPageManifest(
            manifests[page.manifestIndex],
            page.manifestIndex,
            page.offset,
            pageSize,
            sourceRevision,
          )
        : []
    : manifests.map((manifest, index) =>
        relevantManifestPaths.has(stringValue(recordValue(manifest).path) ?? "")
          ? compactManifest(manifest, false, sourceRevision, index)
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
      ...(page?.collection === "dependencies"
        ? {
            dependencies: dependencyPageReceipt(
              manifests[page.manifestIndex],
              page.manifestIndex,
              page.offset,
              selectedManifests,
              pageSize,
              sourceRevision,
            ),
          }
        : {}),
      recommendation:
        "Use the short next_cursor to retrieve exhaustive manifests, dependencies, or task definitions only when needed.",
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

function compactManifest(
  value: unknown,
  allScripts = false,
  sourceRevision?: string,
  manifestIndex?: number,
) {
  const manifest = recordValue(value);
  const scripts = arrayValue(manifest.scripts).map(recordValue);
  const dependencies = arrayValue(manifest.dependencies);
  const paginated =
    sourceRevision !== undefined &&
    manifestIndex !== undefined &&
    serializedBytes(dependencies) > maximumInlineManifestDependencyBytes;
  return {
    path: manifest.path,
    name: manifest.name,
    dependency_count: manifest.dependency_count,
    ...(paginated
      ? {
          dependency_pagination: {
            total: dependencies.length,
            returned: 0,
            next_cursor: encodeDependencyCursor(
              sourceRevision,
              manifestIndex,
              0,
            ),
          },
        }
      : { dependencies }),
    scripts: allScripts
      ? scripts
      : scripts.filter((script) => importantTaskKind(stringValue(script.name))),
  };
}

function dependencyPageManifest(
  value: unknown,
  manifestIndex: number,
  offset: number,
  pageSize: number,
  sourceRevision: string,
) {
  if (value === undefined) return [];
  const manifest = recordValue(value);
  const dependencies = arrayValue(manifest.dependencies);
  const selected = dependencies.slice(offset, offset + pageSize);
  return [
    {
      path: manifest.path,
      name: manifest.name,
      dependency_count: manifest.dependency_count,
      dependencies: selected,
      scripts: arrayValue(manifest.scripts),
      dependency_pagination: {
        total: dependencies.length,
        returned: selected.length,
        offset,
        next_cursor:
          offset + selected.length < dependencies.length
            ? encodeDependencyCursor(
                sourceRevision,
                manifestIndex,
                offset + selected.length,
              )
            : undefined,
      },
    },
  ];
}

function dependencyPageReceipt(
  value: unknown,
  manifestIndex: number,
  offset: number,
  selectedManifests: unknown[],
  pageSize: number,
  sourceRevision: string,
) {
  const manifest = recordValue(value);
  const dependencies = arrayValue(manifest.dependencies);
  const selected = recordValue(selectedManifests[0]);
  const returned = arrayValue(selected.dependencies).length;
  return {
    manifest_path: manifest.path,
    total: dependencies.length,
    returned,
    offset,
    next_cursor:
      offset + returned < dependencies.length
        ? encodeDependencyCursor(
            sourceRevision,
            manifestIndex,
            offset + returned,
          )
        : undefined,
    page_size: pageSize,
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
  collection: "manifests" | "tasks",
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
  collection: "manifests" | "tasks",
  sourceRevision: string,
  offset: number,
) {
  const kind = collection === "manifests" ? "m" : "t";
  return `ws${kind}_${sha256(sourceRevision).slice(0, 10)}_${offset}`;
}

function encodeDependencyCursor(
  sourceRevision: string,
  manifestIndex: number,
  offset: number,
) {
  return `wsd_${sha256(sourceRevision).slice(0, 10)}_${manifestIndex}_${offset}`;
}

function decodeCursor(
  cursor: string | undefined,
  sourceRevision: string,
): WorkspacePage | undefined {
  if (!cursor) return undefined;
  const revisionDigest = sha256(sourceRevision).slice(0, 10);
  const collectionMatch = /^ws([mt])_([a-f0-9]{10})_(\d+)$/u.exec(cursor);
  if (collectionMatch)
    return collectionMatch[2] === revisionDigest
      ? {
          collection: collectionMatch[1] === "m" ? "manifests" : "tasks",
          offset: Number(collectionMatch[3]),
        }
      : undefined;
  const dependencyMatch = /^wsd_([a-f0-9]{10})_(\d+)_(\d+)$/u.exec(cursor);
  if (!dependencyMatch || dependencyMatch[1] !== revisionDigest)
    return undefined;
  return {
    collection: "dependencies",
    manifestIndex: Number(dependencyMatch[2]),
    offset: Number(dependencyMatch[3]),
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
      ? stringValue(recordValue(result.subject_revision).source_revision_id)
      : undefined) ??
    "unversioned"
  );
}

function boundedMaximumTokens(value: number) {
  if (!Number.isFinite(value)) return defaultWorkspaceStateMaximumTokens;
  return Math.max(1, Math.min(20_000, Math.floor(value)));
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

function serializedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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
