import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import {
  discoverProjectFiles,
  fileCountsByExtension,
  isProjectConfigurationPath,
  isProjectEntrypointPath,
  isProjectLockFilePath,
  isProjectManifestPath,
  isRuntimeEvidencePath,
  isSourceCodePath,
  preferNonGeneratedProjectPaths,
  readBoundedProjectFiles,
  selectBalancedProjectPaths,
} from "./project-discovery.js";
import type { MapSecurityAuditResult, SecuritySurfaceMap } from "./types.js";
import { runSecurityScanners } from "./security-audit-scanners.js";

export type SecurityAuditGit = (cwd: string, args: string[]) => Promise<string>;

const frameworkSignals: [RegExp, string][] = [
  [/"@adonisjs\/core"|from\s+["']@adonisjs\//i, "AdonisJS"],
  [/"@angular\/core"/i, "Angular"],
  [/"@nestjs\/core"/i, "NestJS"],
  [/"django"|from\s+django|import\s+django/i, "Django"],
  [/"electron"/i, "Electron"],
  [/"express"/i, "Express"],
  [/"fastapi"|from\s+fastapi/i, "FastAPI"],
  [/"laravel\/framework"/i, "Laravel"],
  [/"next"\s*:/i, "Next.js"],
  [/"nuxt"\s*:/i, "Nuxt"],
  [/"rails"|rails\/application/i, "Rails"],
  [/"react"\s*:/i, "React"],
  [/"spring-boot"|org\.springframework/i, "Spring Boot"],
  [/"svelte"\s*:/i, "Svelte"],
  [/"vue"\s*:/i, "Vue"],
];

const languageNames: Record<string, string> = {
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cs": "C#",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".go": "Go",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scala": "Scala",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
};

export async function scanSecurityAuditRepository(
  root: string,
  git?: SecurityAuditGit,
): Promise<MapSecurityAuditResult> {
  const discovery = await discoverProjectFiles(root);
  const preferredFiles = preferNonGeneratedProjectPaths(
    discovery.files,
    discovery.projectRoots,
  );
  const surfaceMap = await securitySurfaceMap(root, discovery, preferredFiles);
  const revision = await securityRevision(root, discovery.files, git);
  const deterministic = await runSecurityScanners({
    files: preferredFiles,
    repositoryTruncated: discovery.truncated,
    workspaceRoot: root,
  });
  return { revision, surfaceMap, deterministic };
}

async function securitySurfaceMap(
  root: string,
  discovery: Awaited<ReturnType<typeof discoverProjectFiles>>,
  files: string[],
): Promise<SecuritySurfaceMap> {
  const manifests = files.filter(
    (path) => isProjectManifestPath(path) || isProjectLockFilePath(path),
  );
  const infrastructurePaths = files.filter(isInfrastructurePath);
  const ciPaths = files.filter(isCiPath);
  const sensitivePaths = files.filter(isSecuritySensitivePath);
  const entrypoints = files.filter(isProjectEntrypointPath);
  const relevantFiles = files.filter(isSecurityRelevantPath);
  const manifestEvidence = await readBoundedProjectFiles(
    root,
    selectBalancedProjectPaths(manifests, discovery.projectRoots, 64),
    120_000,
    10_000,
  );
  return {
    rootName: basename(root),
    fileCount: discovery.files.length,
    relevantFileCount: relevantFiles.length,
    ignoredDirectoryCount: discovery.ignoredDirectoryCount,
    truncated: discovery.truncated,
    languages: detectedLanguages(files),
    frameworks: detectedFrameworks(manifestEvidence),
    projectRoots: discovery.projectRoots.slice(0, 120),
    services: serviceRoots(discovery.projectRoots),
    entrypoints: balanced(discovery, entrypoints, 100),
    sensitivePaths: balanced(discovery, sensitivePaths, 180),
    dependencyPaths: balanced(discovery, manifests, 100),
    infrastructurePaths: balanced(discovery, infrastructurePaths, 100),
    ciPaths: balanced(discovery, ciPaths, 80),
    evidencePaths: balanced(
      discovery,
      unique([
        ...entrypoints,
        ...sensitivePaths,
        ...infrastructurePaths,
        ...manifests,
        ...files.filter(isProjectConfigurationPath),
        ...files.filter(isSourceCodePath),
      ]),
      360,
    ),
  };
}

function balanced(
  discovery: Awaited<ReturnType<typeof discoverProjectFiles>>,
  paths: string[],
  limit: number,
) {
  return selectBalancedProjectPaths(paths, discovery.projectRoots, limit);
}

function detectedLanguages(files: string[]) {
  const counts = fileCountsByExtension(files.filter(isSourceCodePath));
  const totals = new Map<string, number>();
  for (const [extension, count] of Object.entries(counts)) {
    const language = languageNames[extension.toLowerCase()];
    if (language) totals.set(language, (totals.get(language) ?? 0) + count);
  }
  return [...totals]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([language]) => language);
}

function detectedFrameworks(files: Record<string, string>) {
  const evidence = Object.values(files).join("\n");
  return frameworkSignals
    .filter(([pattern]) => pattern.test(evidence))
    .map(([, framework]) => framework);
}

function serviceRoots(roots: { path: string; markers: string[] }[]) {
  return roots
    .filter(({ markers }) => markers.some((marker) => marker !== ".git"))
    .map(({ path }) => path)
    .slice(0, 80);
}

function isSecurityRelevantPath(path: string) {
  return (
    isSourceCodePath(path) ||
    isProjectManifestPath(path) ||
    isProjectLockFilePath(path) ||
    isProjectConfigurationPath(path) ||
    isRuntimeEvidencePath(path) ||
    isInfrastructurePath(path) ||
    isCiPath(path)
  );
}

function isSecuritySensitivePath(path: string) {
  return /(^|\/)(admin|api|auth|authorization|controllers?|crypto|database|db|filesystem|handlers?|middleware|network|oauth|permissions?|policies|routes?|sessions?|storage|uploads?|webhooks?|workers?)(\/|\.|-|_)/i.test(
    path,
  );
}

function isInfrastructurePath(path: string) {
  const lower = path.toLowerCase();
  const name = basename(lower);
  return (
    /(^|\/)(docker|k8s|kubernetes|terraform|infra|helm)(\/|$)/.test(lower) ||
    /^(dockerfile|compose\.ya?ml|docker-compose\.ya?ml)$/.test(name) ||
    [".tf", ".tfvars"].includes(extname(lower))
  );
}

function isCiPath(path: string) {
  return (
    /(^|\/)\.github\/workflows\//i.test(path) ||
    /(^|\/)(\.gitlab-ci\.ya?ml|jenkinsfile|azure-pipelines\.ya?ml)$/i.test(path)
  );
}

async function securityRevision(
  root: string,
  files: string[],
  git?: SecurityAuditGit,
) {
  if (git) {
    try {
      const commitSha = (await git(root, ["rev-parse", "HEAD"])).trim();
      const branch = (await git(root, ["branch", "--show-current"])).trim();
      const status = auditRelevantGitStatus(
        await git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
      );
      const dirty = Boolean(status.trim());
      const digest = createHash("sha256").update(commitSha).update(status);
      if (dirty) {
        try {
          digest.update(
            await git(root, [
              "diff",
              "--binary",
              "HEAD",
              "--",
              ".",
              ":(exclude).blame/security/**",
            ]),
          );
        } catch {
          // Status still makes the snapshot distinct when a very large diff
          // cannot be transported by the host bridge.
        }
        await hashUntrackedFiles(root, status, digest);
      }
      return {
        ...(branch ? { branch } : {}),
        ...(commitSha ? { commitSha } : {}),
        snapshotDigest: digest.digest("hex"),
        dirty,
      };
    } catch {
      // Non-Git projects use a deterministic content snapshot below.
    }
  }
  const digest = createHash("sha256");
  for (const path of files) await hashFile(root, path, digest);
  return { snapshotDigest: digest.digest("hex"), dirty: true };
}

function auditRelevantGitStatus(status: string) {
  return status
    .split("\n")
    .filter((line) => {
      const path = line.slice(3).trim();
      return path !== ".blame/security" && !path.startsWith(".blame/security/");
    })
    .filter(Boolean)
    .join("\n");
}

async function hashUntrackedFiles(
  root: string,
  status: string,
  digest: ReturnType<typeof createHash>,
) {
  const paths = status
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  for (const path of paths) await hashFile(root, path, digest);
}

async function hashFile(
  root: string,
  path: string,
  digest: ReturnType<typeof createHash>,
) {
  digest.update(path);
  try {
    const info = await stat(join(root, path));
    if (!info.isFile()) return;
    digest.update(await readFile(join(root, path)));
  } catch {
    digest.update("unreadable");
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}
