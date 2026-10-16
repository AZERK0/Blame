import { basename } from "node:path";

import {
  discoverProjectFiles,
  fileCountsByExtension,
  isArchitectureCodePath,
  isProjectConfigurationPath,
  isProjectEntrypointPath,
  isProjectManifestPath,
  isRuntimeEvidencePath,
  isSourceCodePath,
  isTestCodePath,
  preferNonGeneratedProjectPaths,
  projectDirectories,
  selectBalancedProjectPaths,
  type ProjectFileDiscovery,
  type ProjectRootEvidence,
} from "./project-discovery.js";
import {
  balancedGitMessages,
  readBoundedProjectFiles,
  recentProjectGitLogs,
  type ProjectGitLog,
} from "./project-evidence-reader.js";

const maxManifestBytes = 30_000;
const maxConfigurationBytes = 26_000;
const maxTestSampleBytes = 22_000;
const maxSourceSampleBytes = 44_000;

type EvidenceCandidates = {
  manifestFileCount: number;
  manifestPaths: string[];
  configurationFileCount: number;
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
  version: 2;
  rootName: string;
  inventory: {
    scannedFileCount: number;
    scannedDirectoryCount: number;
    ignoredDirectoryCount: number;
    truncated: boolean;
    projectRoots: ProjectRootEvidence[];
    repositoryRoots: string[];
    fileCountsByExtension: Record<string, number>;
    directories: string[];
    architecturePaths: string[];
    evidenceCoverage: {
      manifests: EvidenceCoverage;
      configurations: EvidenceCoverage;
      tests: EvidenceCoverage;
      source: EvidenceCoverage;
    };
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
    repositories?: { root: string; evaluatedCount: number }[];
  };
};

type EvidenceCoverage = {
  discovered: number;
  selected: number;
  included: number;
};

export async function scanProjectCodePractices(
  root: string,
): Promise<ProjectCodePracticesScan> {
  const discovery = await discoverProjectFiles(root);
  const candidates = evidenceCandidates(discovery);
  const evidence = await collectEvidence(root, discovery, candidates);
  return buildPracticesScan(root, discovery, candidates, evidence);
}

function evidenceCandidates(discovery: ProjectFileDiscovery) {
  const { files, projectRoots } = discovery;
  const manifestPaths = preferNonGeneratedProjectPaths(
    files.filter(isProjectManifestPath),
    projectRoots,
  );
  const configurationPaths = preferNonGeneratedProjectPaths(
    files.filter(isPracticesConfigurationPath),
    projectRoots,
  );
  const { testPaths, sourcePaths } = practiceSourcePaths(discovery);
  return {
    manifestFileCount: manifestPaths.length,
    manifestPaths: balancedPaths(manifestPaths, projectRoots, 24),
    configurationFileCount: configurationPaths.length,
    configurationPaths: selectBalancedProjectPaths(
      configurationPaths,
      projectRoots,
      24,
      compareConfigurationPaths,
    ),
    testPaths,
    sourcePaths,
    testSamples: representativePaths(testPaths, projectRoots, 16),
    sourceSamples: representativePaths(sourcePaths, projectRoots, 20),
  };
}

function practiceSourcePaths(discovery: ProjectFileDiscovery) {
  const { files, projectRoots } = discovery;
  const sourceFiles = files.filter(isSourceCodePath);
  return {
    testPaths: preferNonGeneratedProjectPaths(
      sourceFiles.filter(isTestCodePath),
      projectRoots,
    ),
    sourcePaths: preferNonGeneratedProjectPaths(
      sourceFiles.filter((path) => !isTestCodePath(path)),
      projectRoots,
    ),
  };
}

function isPracticesConfigurationPath(path: string) {
  return isProjectConfigurationPath(path) || isRuntimeEvidencePath(path);
}

function balancedPaths(
  paths: string[],
  projectRoots: ProjectRootEvidence[],
  limit: number,
) {
  const preferredPaths = preferNonGeneratedProjectPaths(paths, projectRoots);
  return selectBalancedProjectPaths(preferredPaths, projectRoots, limit);
}

function representativePaths(
  paths: string[],
  projectRoots: ProjectRootEvidence[],
  limit: number,
) {
  return selectBalancedProjectPaths(
    paths,
    projectRoots,
    limit,
    compareRepresentativePaths,
  );
}

async function collectEvidence(
  root: string,
  discovery: ProjectFileDiscovery,
  candidates: EvidenceCandidates,
) {
  const [files, commits] = await Promise.all([
    collectEvidenceFiles(root, candidates),
    commitEvidence(root, discovery.repositoryRoots),
  ]);
  return { ...files, commits };
}

async function collectEvidenceFiles(
  root: string,
  candidates: EvidenceCandidates,
) {
  const requests = evidenceFileRequests(candidates);
  const [manifests, configurations, testSamples, sourceSamples] =
    await Promise.all(
      requests.map(([paths, totalBytes, perFileBytes]) =>
        readBoundedProjectFiles(root, paths, totalBytes, perFileBytes),
      ),
    );
  return { manifests, configurations, testSamples, sourceSamples };
}

function evidenceFileRequests(candidates: EvidenceCandidates) {
  return [
    [candidates.manifestPaths, maxManifestBytes, 5_000],
    [candidates.configurationPaths, maxConfigurationBytes, 4_000],
    [candidates.testSamples, maxTestSampleBytes, 3_000],
    [candidates.sourceSamples, maxSourceSampleBytes, 4_000],
  ] as const;
}

function buildPracticesScan(
  root: string,
  discovery: ProjectFileDiscovery,
  candidates: EvidenceCandidates,
  evidence: CollectedEvidence,
): ProjectCodePracticesScan {
  return {
    version: 2,
    rootName: basename(root),
    inventory: inventorySummary(discovery, candidates, evidence),
    manifests: evidence.manifests,
    configurations: evidence.configurations,
    tests: testEvidence(discovery, candidates, evidence),
    source: sourceEvidence(candidates, evidence),
    commits: evidence.commits,
  };
}

function inventorySummary(
  discovery: ProjectFileDiscovery,
  candidates: EvidenceCandidates,
  evidence: CollectedEvidence,
) {
  const { files, projectRoots } = discovery;
  const inventoryFiles = preferNonGeneratedProjectPaths(files, projectRoots);
  const architecturePaths = inventoryFiles.filter(isArchitectureCodePath);
  return {
    scannedFileCount: files.length,
    scannedDirectoryCount: discovery.scannedDirectoryCount,
    ignoredDirectoryCount: discovery.ignoredDirectoryCount,
    truncated: discovery.truncated,
    projectRoots: projectRoots.slice(0, 120),
    repositoryRoots: discovery.repositoryRoots.slice(0, 60),
    fileCountsByExtension: fileCountsByExtension(inventoryFiles),
    directories: projectDirectories(inventoryFiles).slice(0, 200),
    architecturePaths: balancedPaths(architecturePaths, projectRoots, 120),
    evidenceCoverage: practiceEvidenceCoverage(candidates, evidence),
  };
}

function practiceEvidenceCoverage(
  candidates: EvidenceCandidates,
  evidence: CollectedEvidence,
) {
  return {
    manifests: coverage(
      candidates.manifestFileCount,
      candidates.manifestPaths,
      evidence.manifests,
    ),
    configurations: coverage(
      candidates.configurationFileCount,
      candidates.configurationPaths,
      evidence.configurations,
    ),
    tests: coverage(
      candidates.testPaths.length,
      candidates.testSamples,
      evidence.testSamples,
    ),
    source: coverage(
      candidates.sourcePaths.length,
      candidates.sourceSamples,
      evidence.sourceSamples,
    ),
  };
}

function coverage(
  discovered: number,
  selectedPaths: string[],
  includedFiles: Record<string, string>,
) {
  return {
    discovered,
    selected: selectedPaths.length,
    included: Object.keys(includedFiles).length,
  };
}

function testEvidence(
  discovery: ProjectFileDiscovery,
  candidates: EvidenceCandidates,
  evidence: CollectedEvidence,
) {
  return {
    fileCount: candidates.testPaths.length,
    paths: balancedPaths(candidates.testPaths, discovery.projectRoots, 100),
    samples: evidence.testSamples,
  };
}

function sourceEvidence(
  candidates: EvidenceCandidates,
  evidence: CollectedEvidence,
) {
  return {
    fileCount: candidates.sourcePaths.length,
    representativePaths: Object.keys(evidence.sourceSamples),
    samples: evidence.sourceSamples,
  };
}

function compareConfigurationPaths(left: string, right: string) {
  const priority = configurationPriority(left) - configurationPriority(right);
  return priority || left.length - right.length || left.localeCompare(right);
}

function configurationPriority(path: string) {
  const name = fileName(path);
  if (
    /(biome|checkstyle|clang|clippy|credo|detekt|editorconfig|eslint|golangci|ktlint|mypy|phpcs|phpstan|prettier|psalm|rubocop|ruff|rustfmt|spotbugs|stylecop|stylelint|swiftformat|swiftlint|tsconfig)/.test(
      name,
    )
  )
    return 0;
  if (
    /(cypress|jest|nextest|phpunit|playwright|pytest|rspec|tox|vitest)/.test(
      name,
    )
  )
    return 1;
  if (/(^|\/)\.github\/workflows\//.test(path)) return 3;
  return 2;
}

function compareRepresentativePaths(left: string, right: string) {
  const priority = representativePriority(left) - representativePriority(right);
  return priority || left.length - right.length || left.localeCompare(right);
}

function representativePriority(path: string) {
  if (isArchitectureCodePath(path)) return 0;
  if (isProjectEntrypointPath(path)) return 1;
  if (/(^|\/)src\//.test(path)) return 2;
  return 3;
}

async function commitEvidence(root: string, repositoryRoots: string[]) {
  const logs = await recentProjectGitLogs(root, repositoryRoots, 40);
  const messages = balancedGitMessages(logs, 40);
  const conventionalMessages = messages.filter(isConventionalCommit);
  return {
    evaluatedCount: messages.length,
    conventionalCount: conventionalMessages.length,
    conventionalRatio: messages.length
      ? conventionalMessages.length / messages.length
      : null,
    messages,
    nonConventionalMessages: messages.filter(
      (message) => !isConventionalCommit(message),
    ),
    repositories: repositoryEvidence(logs),
  };
}

function repositoryEvidence(logs: ProjectGitLog[]) {
  return logs.map(({ root, messages }) => ({
    root,
    evaluatedCount: messages.length,
  }));
}

function isConventionalCommit(message: string) {
  return /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]+\))?!?: .+/.test(
    message,
  );
}

function fileName(path: string) {
  return path.split("/").at(-1)?.toLowerCase() ?? "";
}
