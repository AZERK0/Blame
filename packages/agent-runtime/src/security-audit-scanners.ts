import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import {
  isProjectConfigurationPath,
  isProjectManifestPath,
  isProjectLockFilePath,
  isSourceCodePath,
} from "./project-discovery.js";
import {
  detectSecuritySecrets,
  redactSecuritySecrets,
} from "./security-secret-redaction.js";
import type {
  SecurityCandidate,
  SecurityDeterministicScanResult,
  SecurityScannerCoverage,
} from "./types.js";

export type SecurityScannerContext = {
  files: string[];
  repositoryTruncated: boolean;
  workspaceRoot: string;
};

export type SecurityScannerResult = {
  candidates: SecurityCandidate[];
  inspectedPaths: string[];
  coverage: SecurityScannerCoverage;
};

export interface SecurityScanner {
  id: string;
  detect(context: SecurityScannerContext): Promise<SecurityScannerResult>;
}

const maximumFileBytes = 1024 * 1024;
const maximumCandidates = 100;
const scannerConcurrency = 24;

export async function runSecurityScanners(
  context: SecurityScannerContext,
  scanners: SecurityScanner[] = [new LocalSecretScanner()],
): Promise<SecurityDeterministicScanResult> {
  const results = await Promise.all(
    scanners.map((scanner) => scanner.detect(context)),
  );
  return {
    candidates: results.flatMap(({ candidates }) => candidates),
    inspectedPaths: unique(
      results.flatMap(({ inspectedPaths }) => inspectedPaths),
    ),
    limitations: unique(
      results.flatMap(({ coverage }) => coverage.limitations),
    ),
    scanners: results.map(({ coverage }) => coverage),
  };
}

export class LocalSecretScanner implements SecurityScanner {
  id = "local-secret-scanner";

  async detect(
    context: SecurityScannerContext,
  ): Promise<SecurityScannerResult> {
    const paths = context.files.filter(isSecretScannablePath);
    const candidates: SecurityCandidate[] = [];
    const inspectedPaths: string[] = [];
    let unreadableFiles = 0;
    for (let index = 0; index < paths.length; index += scannerConcurrency) {
      const results = await Promise.all(
        paths
          .slice(index, index + scannerConcurrency)
          .map((path) => scanFile(context.workspaceRoot, path)),
      );
      for (const result of results) {
        if (!result) {
          unreadableFiles += 1;
          continue;
        }
        inspectedPaths.push(result.path);
        for (const signal of result.signals) {
          if (candidates.length >= maximumCandidates) break;
          candidates.push(secretCandidate(result.path, result.content, signal));
        }
      }
    }
    const limitations = [
      ...(context.repositoryTruncated
        ? ["Repository discovery was truncated before secret scanning."]
        : []),
      ...(unreadableFiles
        ? [`${unreadableFiles} candidate files could not be scanned locally.`]
        : []),
      ...(candidates.length >= maximumCandidates
        ? [`Secret candidates were capped at ${maximumCandidates}.`]
        : []),
      "Git history and entropy-based secret detection were not scanned.",
    ];
    return {
      candidates,
      inspectedPaths: unique(
        candidates.flatMap(({ locations }) =>
          locations.map(({ path }) => path),
        ),
      ),
      coverage: {
        id: this.id,
        reviewedFiles: inspectedPaths.length,
        totalFiles: paths.length,
        status:
          context.repositoryTruncated || unreadableFiles
            ? "partial"
            : "limited",
        limitations,
      },
    };
  }
}

async function scanFile(root: string, path: string) {
  try {
    const absolute = join(root, path);
    const info = await stat(absolute);
    if (!info.isFile() || info.size > maximumFileBytes) return undefined;
    const content = await readFile(absolute, "utf8");
    if (content.includes("\0")) return undefined;
    return { path, content, signals: detectSecuritySecrets(content) };
  } catch {
    return undefined;
  }
}

function secretCandidate(
  path: string,
  content: string,
  signal: ReturnType<typeof detectSecuritySecrets>[number],
): SecurityCandidate {
  const startLine = content.slice(0, signal.start).split("\n").length;
  const id = createHash("sha256")
    .update(`${signal.kind}\0${path}\0${startLine}`)
    .digest("hex")
    .slice(0, 12);
  const line = content.split("\n")[startLine - 1] ?? "";
  const title = `Potential ${secretLabel(signal.kind)} exposed`;
  return {
    id: `secret-${id}`,
    sourceCandidateIds: [`secret-${id}`],
    sources: ["scanner:local-secret-scanner"],
    title,
    summary:
      "A credential-shaped value was detected locally. Its value was redacted before any model context was created.",
    vulnerabilityFamily: "hard-coded-credential",
    rootControl: "secret-storage",
    component: path.split("/")[0] ?? ".",
    attacker:
      "An actor able to read the repository, build context, or distributed artifact",
    asset: "Credential or private key",
    locations: [{ path, startLine, endLine: startLine }],
    evidence: [
      {
        summary: `${secretLabel(signal.kind)} signature detected by the local scanner; validate repository exposure and runtime use.`,
        location: { path, startLine, endLine: startLine },
        code: redactSecuritySecrets(line).trim().slice(0, 500),
      },
    ],
    taxonomy: { cwe: ["CWE-798"] },
  };
}

function isSecretScannablePath(path: string) {
  const name = basename(path).toLowerCase();
  const extension = extname(name);
  return (
    isSourceCodePath(path) ||
    isProjectManifestPath(path) ||
    isProjectLockFilePath(path) ||
    isProjectConfigurationPath(path) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    name.endsWith(".env") ||
    [
      ".conf",
      ".ini",
      ".json",
      ".md",
      ".properties",
      ".txt",
      ".toml",
      ".xml",
      ".yaml",
      ".yml",
    ].includes(extension)
  );
}

function secretLabel(kind: string) {
  return kind.toLowerCase().replaceAll("_", " ");
}

function unique(values: string[]) {
  return [...new Set(values)];
}
