import { execFile } from "node:child_process";
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { withoutTelemetryEnvironment } from "@blame/telemetry";

const execFileAsync = promisify(execFile);
const maxScannedFiles = 20_000;
const maxDirectoryDepth = 12;
const maxManifestBytes = 36_000;
const maxConfigurationBytes = 32_000;
const maxTestSampleBytes = 28_000;
const maxSourceSampleBytes = 56_000;
const ignoredDirectories = new Set([
  ".git",
  ".blame",
  ".adonisjs",
  ".angular",
  ".cache",
  ".code-review-graph",
  ".dart_tool",
  ".gradle",
  ".idea",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".venv",
  "__generated__",
  "_build",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "target",
  "tmp",
  "vendor",
]);
const manifestNames = new Set([
  "build.gradle",
  "build.gradle.kts",
  "cargo.toml",
  "composer.json",
  "deno.json",
  "deno.jsonc",
  "gemfile",
  "go.mod",
  "mix.exs",
  "package.json",
  "package.swift",
  "pom.xml",
  "pubspec.yaml",
  "pyproject.toml",
  "settings.gradle",
  "settings.gradle.kts",
]);
const sourceExtensions = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".cts",
  ".ex",
  ".exs",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

type ProjectFileInventory = {
  files: string[];
  truncated: boolean;
};

type ProjectFileInventoryState = ProjectFileInventory & {
  root: string;
};

type EvidenceCandidates = {
  manifestPaths: string[];
  configurationPaths: string[];
  testPaths: string[];
  sourcePaths: string[];
  testSamples: string[];
  sourceSamples: string[];
};

type CollectedEvidence = {
  manifests: Record<string, string>;
  configurations: Record<string, string>;
  testSamples: Record<string, string>;
  sourceSamples: Record<string, string>;
  commits: ProjectCodePracticesScan["commits"];
};

export type ProjectCodePracticesScan = {
  version: 1;
  rootName: string;
  inventory: {
    scannedFileCount: number;
    truncated: boolean;
    fileCountsByExtension: Record<string, number>;
    directories: string[];
    architecturePaths: string[];
  };
  manifests: Record<string, string>;
  configurations: Record<string, string>;
  tests: {
    fileCount: number;
    paths: string[];
    samples: Record<string, string>;
  };
  source: {
    fileCount: number;
    representativePaths: string[];
    samples: Record<string, string>;
  };
  commits: {
    evaluatedCount: number;
    conventionalCount: number;
    conventionalRatio: number | null;
    messages: string[];
    nonConventionalMessages: string[];
  };
};

export async function scanProjectCodePractices(
  root: string,
): Promise<ProjectCodePracticesScan> {
  const inventory = await projectFileInventory(root);
  const candidates = evidenceCandidates(inventory.files);
  const evidence = await collectEvidence(root, candidates);
  return buildPracticesScan(root, inventory, candidates, evidence);
}

function evidenceCandidates(files: string[]): EvidenceCandidates {
  const testPaths = files.filter(isTestFile);
  const sourcePaths = files.filter(
    (path) => isSourceFile(path) && !isTestFile(path),
  );
  const configurationPaths = files
    .filter(isConfigurationFile)
    .sort(compareConfigurationPaths);
  return {
    manifestPaths: files.filter(isManifestFile),
    configurationPaths,
    testPaths,
    sourcePaths,
    testSamples: selectRepresentativePaths(testPaths, 12),
    sourceSamples: selectRepresentativePaths(sourcePaths, 18),
  };
}

async function collectEvidence(root: string, candidates: EvidenceCandidates) {
  const {
    manifestPaths,
    configurationPaths,
    testSamples: testPaths,
    sourceSamples: sourcePaths,
  } = candidates;
  const [manifests, configurations, testSamples, sourceSamples, commits] =
    await Promise.all([
      readEvidenceFiles(root, manifestPaths, maxManifestBytes, 6_000),
      readEvidenceFiles(root, configurationPaths, maxConfigurationBytes, 5_000),
      readEvidenceFiles(root, testPaths, maxTestSampleBytes, 4_000),
      readEvidenceFiles(root, sourcePaths, maxSourceSampleBytes, 5_000),
      commitEvidence(root),
    ]);
  return { manifests, configurations, testSamples, sourceSamples, commits };
}

function buildPracticesScan(
  root: string,
  inventory: ProjectFileInventory,
  candidates: EvidenceCandidates,
  evidence: CollectedEvidence,
): ProjectCodePracticesScan {
  return {
    version: 1,
    rootName: basename(root),
    inventory: inventorySummary(inventory),
    manifests: evidence.manifests,
    configurations: evidence.configurations,
    tests: {
      fileCount: candidates.testPaths.length,
      paths: candidates.testPaths.slice(0, 120),
      samples: evidence.testSamples,
    },
    source: {
      fileCount: candidates.sourcePaths.length,
      representativePaths: Object.keys(evidence.sourceSamples),
      samples: evidence.sourceSamples,
    },
    commits: evidence.commits,
  };
}

async function projectFileInventory(root: string) {
  const state: ProjectFileInventoryState = {
    root,
    files: [],
    truncated: false,
  };
  await visitDirectory(state, "", 0);
  state.files.sort((left, right) => left.localeCompare(right));
  return { files: state.files, truncated: state.truncated };
}

async function visitDirectory(
  state: ProjectFileInventoryState,
  relativeDirectory: string,
  depth: number,
) {
  if (depth > maxDirectoryDepth || state.truncated) return;
  const entries = await directoryEntries(join(state.root, relativeDirectory));
  for (const entry of entries) {
    const path = relativePath(relativeDirectory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      await visitDirectory(state, path, depth + 1);
    }
    if (entry.isFile()) addInventoryFile(state, path);
    if (state.truncated) return;
  }
}

async function directoryEntries(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  } catch {
    return [];
  }
}

function addInventoryFile(state: ProjectFileInventoryState, path: string) {
  if (state.files.length >= maxScannedFiles) {
    state.truncated = true;
    return;
  }
  state.files.push(path);
}

function inventorySummary(inventory: ProjectFileInventory) {
  return {
    scannedFileCount: inventory.files.length,
    truncated: inventory.truncated,
    fileCountsByExtension: fileCountsByExtension(inventory.files),
    directories: projectDirectories(inventory.files),
    architecturePaths: inventory.files.filter(isArchitecturePath).slice(0, 160),
  };
}

function fileCountsByExtension(paths: string[]) {
  return paths.reduce<Record<string, number>>((counts, path) => {
    const extension = extname(path).toLowerCase() || "[no extension]";
    counts[extension] = (counts[extension] ?? 0) + 1;
    return counts;
  }, {});
}

function projectDirectories(paths: string[]) {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = dirname(path)
      .split("/")
      .filter((part) => part && part !== ".")
      .slice(0, 4);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      directories.add(parts.slice(0, depth).join("/"));
    }
  }
  return [...directories].sort().slice(0, 400);
}

function isManifestFile(path: string) {
  const name = basename(path).toLowerCase();
  return (
    manifestNames.has(name) ||
    name === "go.work" ||
    name === "pnpm-workspace.yaml" ||
    name === "requirements.txt" ||
    name === "requirements-dev.txt"
  );
}

function isConfigurationFile(path: string) {
  const name = basename(path).toLowerCase();
  if (isManifestFile(path)) return false;
  if (name.endsWith(".tsbuildinfo")) return false;
  if (path.startsWith(".github/workflows/")) return /\.ya?ml$/.test(name);
  return configurationName(name);
}

function configurationName(name: string) {
  return /^(\.babelrc|\.commitlintrc|\.editorconfig|\.eslintrc|\.flake8|\.golangci|\.prettierrc|\.stylelintrc|biome|commitlint|cypress|eslint|jest|lint-staged|mypy|phpunit|playwright|prettier|pytest|ruff|setup\.cfg|stylelint|tox\.ini|tsconfig|turbo|vitest)/.test(
    name,
  );
}

function compareConfigurationPaths(left: string, right: string) {
  const priority = configurationPriority(left) - configurationPriority(right);
  return priority || left.length - right.length || left.localeCompare(right);
}

function configurationPriority(path: string) {
  const name = basename(path).toLowerCase();
  if (
    /(eslint|biome|prettier|ruff|mypy|tsconfig|stylelint|golangci)/.test(name)
  )
    return 0;
  if (/(vitest|jest|playwright|cypress|pytest|phpunit|tox)/.test(name))
    return 1;
  if (path.startsWith(".github/workflows/")) return 3;
  return 2;
}

function isTestFile(path: string) {
  const normalized = path.toLowerCase();
  if (/(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(normalized)) return true;
  if (/\.(test|spec)\.[^/]+$/.test(normalized)) return true;
  return /(^|\/)(test_[^/]+|[^/]+_test)\.[^/]+$/.test(normalized);
}

function isSourceFile(path: string) {
  if (path.toLowerCase().endsWith(".d.ts")) return false;
  return sourceExtensions.has(extname(path).toLowerCase());
}

function isArchitecturePath(path: string) {
  return /(^|\/)(adapters?|application|controllers?|domain|entities|infrastructure|ports?|repositories|services|use[-_]?cases?)(\/|\.|-|_)/i.test(
    path,
  );
}

function selectRepresentativePaths(paths: string[], limit: number) {
  const groups = representativeGroups(paths);
  const selected: string[] = [];
  while (selected.length < limit) {
    const previousLength = selected.length;
    for (const group of groups) {
      const path = group.shift();
      if (path) selected.push(path);
      if (selected.length >= limit) break;
    }
    if (selected.length === previousLength) break;
  }
  return selected;
}

function representativeGroups(paths: string[]) {
  const groups = new Map<string, string[]>();
  for (const path of [...paths].sort(compareRepresentativePaths)) {
    const area = projectArea(path);
    const group = groups.get(area) ?? [];
    group.push(path);
    groups.set(area, group);
  }
  return [...groups.values()];
}

function compareRepresentativePaths(left: string, right: string) {
  const priority = representativePriority(left) - representativePriority(right);
  return priority || left.length - right.length || left.localeCompare(right);
}

function representativePriority(path: string) {
  if (isArchitecturePath(path)) return 0;
  if (/(^|\/)(index|main|app|server)\.[^/]+$/i.test(path)) return 1;
  if (path.includes("/src/")) return 2;
  return 3;
}

function projectArea(path: string) {
  const parts = path.split("/");
  if (["apps", "libs", "packages", "services"].includes(parts[0] ?? "")) {
    return parts.slice(0, 2).join("/");
  }
  return parts[0] ?? path;
}

async function readEvidenceFiles(
  root: string,
  paths: string[],
  totalBytes: number,
  perFileBytes: number,
) {
  const evidence: Record<string, string> = {};
  let remainingBytes = totalBytes;
  for (const path of paths) {
    if (remainingBytes <= 0) break;
    const content = await readEvidenceFile(
      root,
      path,
      Math.min(perFileBytes, remainingBytes),
    );
    if (content === undefined) continue;
    evidence[path] = content;
    remainingBytes -= Buffer.byteLength(content);
  }
  return evidence;
}

async function readEvidenceFile(root: string, path: string, maxBytes: number) {
  const target = join(root, path);
  try {
    const info = await stat(target);
    if (!info.isFile()) return undefined;
    return await readFilePrefix(target, info.size, maxBytes);
  } catch {
    return undefined;
  }
}

async function readFilePrefix(path: string, size: number, maxBytes: number) {
  const handle = await open(path, "r");
  try {
    const bytesToRead = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const suffix = size > bytesRead ? "\n[truncated]" : "";
    return buffer.subarray(0, bytesRead).toString("utf8") + suffix;
  } finally {
    await handle.close();
  }
}

async function commitEvidence(root: string) {
  const messages = await recentCommitMessages(root);
  const conventionalMessages = messages.filter(isConventionalCommit);
  const nonConventionalMessages = messages.filter(
    (message) => !isConventionalCommit(message),
  );
  return {
    evaluatedCount: messages.length,
    conventionalCount: conventionalMessages.length,
    conventionalRatio: messages.length
      ? conventionalMessages.length / messages.length
      : null,
    messages,
    nonConventionalMessages,
  };
}

async function recentCommitMessages(root: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-40", "--no-merges", "--pretty=%s"],
      {
        cwd: root,
        env: withoutTelemetryEnvironment(process.env),
        timeout: 3_000,
      },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isConventionalCommit(message: string) {
  return /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?!?: .+/.test(
    message,
  );
}

function relativePath(directory: string, name: string) {
  return directory ? `${directory}/${name}` : name;
}
