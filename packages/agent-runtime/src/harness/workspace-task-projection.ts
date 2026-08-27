import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseCode } from "./code-intelligence.js";
import type { DependencyMutationCapability } from "./dependency-mutation-service.js";
import type { TaskCatalogItem } from "./schemas.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

type ManifestInventory = {
  dependency_count: number;
  dependencies: Array<{ name: string; type: string; version: string }>;
  name?: string;
  path: string;
  truncated: boolean;
};

export async function workspaceTaskProjection(input: {
  dependencyCapability: DependencyMutationCapability;
  files: WorkspaceFiles;
  objective?: string;
  snapshot: WorkspaceSnapshot;
  tasks: TaskCatalogItem[];
}) {
  const terms = objectiveTerms(input.objective);
  const manifests = await manifestInventory(
    input.files.root,
    input.snapshot,
    terms,
  );
  const relevant = await relevantTargets(input.files, input.snapshot, terms);
  return {
    packages: manifests.map(packageProjection),
    dependency_inventory: {
      manifests,
      lockfile: await lockfileInventory(
        input.files.root,
        input.snapshot,
        terms,
      ),
      mutation: input.dependencyCapability,
    },
    executable_tasks: input.tasks.map(({ task_id, kind, cwd }) => ({
      task_id,
      kind,
      cwd,
    })),
    relevant_targets: relevant,
  };
}

async function manifestInventory(
  root: string,
  snapshot: WorkspaceSnapshot,
  terms: string[],
) {
  const paths = snapshot.files.filter(
    (path) => basename(path) === "package.json",
  );
  const manifests = await Promise.all(
    paths.slice(0, 100).map((path) => readManifest(root, path, terms)),
  );
  return manifests.filter((value): value is ManifestInventory =>
    Boolean(value),
  );
}

async function readManifest(root: string, path: string, terms: string[]) {
  try {
    const manifest = JSON.parse(
      await readFile(join(root, path), "utf8"),
    ) as Record<string, unknown>;
    const dependencies = dependencyEntries(manifest).sort((left, right) =>
      relevanceOrder(left.name, right.name, terms),
    );
    return {
      path,
      ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
      dependency_count: dependencies.length,
      dependencies: dependencies.slice(0, 20),
      truncated: dependencies.length > 20,
    } satisfies ManifestInventory;
  } catch {
    return undefined;
  }
}

function dependencyEntries(manifest: Record<string, unknown>) {
  const types = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];
  return types.flatMap((type) => {
    const values = recordValue(manifest[type]);
    return Object.entries(values).flatMap(([name, version]) =>
      typeof version === "string" ? [{ name, type, version }] : [],
    );
  });
}

function packageProjection(manifest: ManifestInventory) {
  const segments = manifest.path.split("/");
  const collection = segments[0] === "apps" ? "application" : "package";
  return {
    path: manifest.path,
    ...(manifest.name ? { name: manifest.name } : {}),
    collection,
  };
}

async function lockfileInventory(
  root: string,
  snapshot: WorkspaceSnapshot,
  terms: string[],
) {
  const path = snapshot.files.find((candidate) =>
    lockfileNames.has(basename(candidate)),
  );
  if (!path) return { present: false, package_count: 0, packages: [] };
  const packages = await lockfilePackages(join(root, path), basename(path));
  packages.sort((left, right) => relevanceOrder(left, right, terms));
  return {
    present: true,
    path,
    package_count: packages.length,
    packages: packages.slice(0, 40),
    truncated: packages.length > 40,
  };
}

async function lockfilePackages(path: string, name: string) {
  try {
    const source = await readFile(path, "utf8");
    if (name === "package-lock.json") return packageLockPackages(source);
    return textLockPackages(source);
  } catch {
    return [];
  }
}

function packageLockPackages(source: string) {
  const value = JSON.parse(source) as { packages?: Record<string, unknown> };
  return unique(
    Object.keys(value.packages ?? {}).flatMap((path) =>
      path.includes("node_modules/")
        ? [path.split("node_modules/").at(-1)!]
        : [],
    ),
  );
}

function textLockPackages(source: string) {
  const packages: string[] = [];
  for (const match of source.matchAll(
    /^\s{0,4}['"]?(@?[^\s:'"]+\/[^\s:'"]+|[^\s:'"/]+)@[^:\s]+['"]?:/gmu,
  ))
    if (validPackageName(match[1])) packages.push(match[1]!);
  return unique(packages);
}

async function relevantTargets(
  files: WorkspaceFiles,
  snapshot: WorkspaceSnapshot,
  terms: string[],
) {
  const changed = new Set(snapshot.changes.map((change) => change.path));
  const ranked = snapshot.files
    .map((path) => ({ path, score: pathScore(path, terms, changed.has(path)) }))
    .filter(({ score }) => score > 0)
    .sort(scoreOrder)
    .slice(0, 16);
  return Promise.all(
    ranked.map(async ({ path, score }) => ({
      path,
      score,
      symbols: await relevantSymbols(files, path, terms),
    })),
  );
}

async function relevantSymbols(
  files: WorkspaceFiles,
  path: string,
  terms: string[],
) {
  try {
    if ((await files.fileSize(path)) > 128 * 1024) return [];
    const content = (await files.read(path)).content;
    return parseCode(path, content)
      .symbols.map((symbol) => ({
        kind: symbol.kind,
        name: symbol.qualified_name,
        score: termScore(symbol.qualified_name, terms),
      }))
      .filter(({ score }) => score > 0)
      .sort(scoreOrder)
      .slice(0, 8)
      .map(({ kind, name }) => ({ kind, name }));
  } catch {
    return [];
  }
}

function pathScore(path: string, terms: string[], changed: boolean) {
  const normalized = path.toLowerCase();
  const conventional =
    /(?:app|api|components?|pages?|routes?|schema|styles?)/u.test(normalized);
  return (
    (changed ? 100 : 0) + termScore(normalized, terms) + (conventional ? 2 : 0)
  );
}

function termScore(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.reduce(
    (score, term) => score + (normalized.includes(term) ? 10 : 0),
    0,
  );
}

function objectiveTerms(objective?: string) {
  return unique(
    (objective ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}_-]{3,}/gu) ?? [],
  )
    .filter((term) => !ignoredTerms.has(term))
    .slice(0, 40);
}

function relevanceOrder(left: string, right: string, terms: string[]) {
  return (
    termScore(right, terms) - termScore(left, terms) ||
    left.localeCompare(right)
  );
}

function scoreOrder(
  left: { path?: string; name?: string; score: number },
  right: { path?: string; name?: string; score: number },
) {
  return (
    right.score - left.score ||
    String(left.path ?? left.name).localeCompare(
      String(right.path ?? right.name),
    )
  );
}

function validPackageName(value?: string): value is string {
  return Boolean(
    value && /^(?:@[a-z0-9._~-]+\/[a-z0-9._~-]+|[a-z0-9._~-]+)$/iu.test(value),
  );
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const lockfileNames = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const ignoredTerms = new Set([
  "avec",
  "dans",
  "from",
  "pour",
  "that",
  "this",
  "une",
  "user",
  "utilisateur",
]);
