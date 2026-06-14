import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import {
  dirnameWorkspacePath,
  joinWorkspacePath,
  mkdir as mkdirRuntime,
  pathExists as runtimePathExists,
  readDirectory as readRuntimeDirectory,
  readFile as readRuntimeFile,
  runtimeManagedPath,
  writeFile as writeRuntimeFile,
} from "./workspace-runtime.ts";
import { runtimeAgentClient, runtimeAgentSupported } from "./runtime-agent.ts";

const ignoredEnvDirectories = new Set([
  ".git",
  ".blame",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const envTemplateSuffixes = [".example", ".sample", ".template"];

type Linker = (sourcePath: string, destinationPath: string) => Promise<void>;

export type SyncedEnvFile = {
  destinationPath: string;
  linkedAs: "hardlink" | "symlink" | "runtime-copy";
  sourcePath: string;
};

export type EnvHostFileMount = {
  containerPath: string;
  hostPath: string;
};

const publicOriginEnvironmentKeys = new Set([
  "APP_URL",
  "APPLICATION_URL",
  "BETTER_AUTH_URL",
  "CANONICAL_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_BASE_URL",
  "NEXTAUTH_URL",
  "PUBLIC_URL",
  "SITE_URL",
]);

export async function syncProjectEnvFiles(
  repositoryRoot: string,
  worktree: string,
) {
  const files = await prepareProjectEnvFiles(repositoryRoot);
  return Promise.all(
    files.map((path) => linkWorktreeEnvFile(repositoryRoot, worktree, path)),
  );
}

async function linkWorktreeEnvFile(
  repositoryRoot: string,
  worktree: string,
  sourcePath: string,
): Promise<SyncedEnvFile> {
  const destinationPath = joinWorkspacePath(
    worktree,
    relative(repositoryRoot, sourcePath),
  );
  if (runtimeManagedPath(worktree)) {
    await writeRuntimeEnvFile(destinationPath, sourcePath);
    return { destinationPath, linkedAs: "runtime-copy", sourcePath };
  }
  if (await sameFile(sourcePath, destinationPath))
    return { destinationPath, linkedAs: "hardlink", sourcePath };
  if (await pathExists(destinationPath)) {
    await mergeEnvFileValues(destinationPath, sourcePath);
    await rm(destinationPath, { force: true });
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  const linkedAs = await linkEnvFile(sourcePath, destinationPath);
  return { destinationPath, linkedAs, sourcePath };
}

export async function linkEnvFile(
  sourcePath: string,
  destinationPath: string,
  createLink: Linker = link,
) {
  try {
    await createLink(sourcePath, destinationPath);
    return "hardlink";
  } catch (error) {
    if (!crossDeviceLinkError(error)) throw error;
    await symlink(sourcePath, destinationPath);
    return "symlink";
  }
}

export async function envHostFileMounts(worktree: string) {
  if (runtimeManagedPath(worktree)) return [];
  const files = await projectEnvFiles(worktree);
  const mounts = await Promise.all(
    files.runtime.map((path) => envHostFileMount(worktree, path)),
  );
  return mounts.filter((mount): mount is EnvHostFileMount => Boolean(mount));
}

export async function materializedPreviewEnvHostFileMounts(
  worktree: string,
  previewOrigin: string | undefined,
) {
  if (!previewOrigin) return [];
  const files = await projectEnvFiles(worktree);
  const mounts = await Promise.all(
    files.runtime.map((path) =>
      materializedPreviewEnvHostFileMount(worktree, path, previewOrigin),
    ),
  );
  return mounts.filter((mount): mount is EnvHostFileMount => Boolean(mount));
}

export async function materializedPreviewEnvFilesMatch(
  worktree: string,
  previewOrigin: string | undefined,
) {
  if (!previewOrigin) return true;
  const files = await projectEnvFiles(worktree);
  const matches = await Promise.all(
    files.runtime.map((path) =>
      materializedPreviewEnvFileMatches(worktree, path, previewOrigin),
    ),
  );
  return matches.every(Boolean);
}

async function materializedPreviewEnvHostFileMount(
  worktree: string,
  path: string,
  previewOrigin: string,
) {
  const content = await readWorkspaceEnvFile(path);
  const materialized = materializePreviewEnvValues(content, previewOrigin);
  if (materialized === content) return null;
  const relativePath = relativeWorkspacePath(worktree, path);
  const hostPath = joinWorkspacePath(
    worktree,
    ".blame",
    "env-overrides",
    relativePath,
  );
  await writeWorkspaceEnvFile(hostPath, materialized);
  return {
    containerPath: relativePath,
    hostPath,
  };
}

async function materializedPreviewEnvFileMatches(
  worktree: string,
  path: string,
  previewOrigin: string,
) {
  const content = await readWorkspaceEnvFile(path);
  const materialized = materializePreviewEnvValues(content, previewOrigin);
  if (materialized === content) return true;
  const relativePath = relativeWorkspacePath(worktree, path);
  const hostPath = joinWorkspacePath(
    worktree,
    ".blame",
    "env-overrides",
    relativePath,
  );
  try {
    return (await readWorkspaceEnvFile(hostPath)) === materialized;
  } catch {
    return false;
  }
}

export function materializePreviewEnvValues(
  content: string,
  previewOrigin: string,
) {
  let hasPublicOrigin = false;
  let hasNextPublicAppUrl = false;
  const lines = content.split("\n").map((line) => {
    const parsed = envLine(line);
    if (!parsed) return line;
    if (parsed.key === "NEXT_PUBLIC_APP_URL") hasNextPublicAppUrl = true;
    if (!publicOriginEnvironmentKeys.has(parsed.key)) return line;
    hasPublicOrigin = true;
    const nextValue = materializedPreviewEnvValue(parsed.value, previewOrigin);
    return `${parsed.key}=${nextValue}`;
  });
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (hasPublicOrigin && !hasNextPublicAppUrl) {
    lines.push(`NEXT_PUBLIC_APP_URL=${previewOrigin}`);
  }
  return normalizeEnvText(lines.join("\n"));
}

function materializedPreviewEnvValue(value: string, previewOrigin: string) {
  const quote = envValueQuote(value);
  const unquoted = unquoteEnvValue(value.trim());
  let nextValue = unquoted;
  try {
    const url = new URL(unquoted);
    if (localPreviewHost(url.hostname)) {
      nextValue = `${previewOrigin}${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    nextValue = previewOrigin;
  }
  return quote ? `${quote}${nextValue}${quote}` : nextValue;
}

function envValueQuote(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return '"';
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return "'";
  return "";
}

function unquoteEnvValue(value: string) {
  const quote = envValueQuote(value);
  return quote ? value.slice(1, -1) : value;
}

function localPreviewHost(host: string) {
  return host === "localhost" || host === "127.0.0.1";
}

async function envHostFileMount(worktree: string, path: string) {
  const info = await lstat(path);
  if (!info.isSymbolicLink()) return null;
  const target = await readlink(path);
  return {
    containerPath: relative(worktree, path).replace(/\\/g, "/"),
    hostPath: resolve(dirname(path), target),
  };
}

async function writeRuntimeEnvFile(destinationPath: string, sourcePath: string) {
  const source = await readFile(sourcePath, "utf8");
  const destination = (await runtimePathExists(destinationPath))
    ? await readRuntimeFile(destinationPath)
    : "";
  const content = destination ? mergeEnvValues(destination, source) : source;
  await mkdirRuntime(dirnameWorkspacePath(destinationPath));
  await writeRuntimeFile(destinationPath, content);
}

async function prepareProjectEnvFiles(root: string) {
  const files = await projectEnvFiles(root);
  await Promise.all(
    files.templates.map(async (templatePath) => {
      const runtimePath = runtimeEnvPath(templatePath);
      if (!runtimePath || (await pathExists(runtimePath))) return;
      await copyFile(templatePath, runtimePath);
      files.runtime.push(runtimePath);
    }),
  );
  return uniqueStrings(files.runtime);
}

function runtimeEnvPath(path: string) {
  const suffix = envTemplateSuffixes.find((suffix) => path.endsWith(suffix));
  if (!suffix) return undefined;
  const runtimePath = path.slice(0, -suffix.length);
  if (!runtimeEnvFile(basename(runtimePath))) return undefined;
  return runtimePath;
}

async function sameFile(left: string, right: string) {
  try {
    const [leftStat, rightStat] = await Promise.all([stat(left), stat(right)]);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    return false;
  }
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function mergeEnvFileValues(sourcePath: string, destinationPath: string) {
  const source = await readFile(sourcePath, "utf8");
  const destination = await readFile(destinationPath, "utf8");
  const merged = mergeEnvValues(source, destination);
  if (merged !== destination) await writeFile(destinationPath, merged, "utf8");
}

export function mergeEnvValues(source: string, destination: string) {
  const sourceValues = envValues(source);
  const usedKeys = new Set<string>();
  const lines = destination.split("\n").map((line) => {
    const parsed = envLine(line);
    if (!parsed) return line;
    usedKeys.add(parsed.key);
    if (!blankEnvValue(parsed.value)) return line;
    const sourceLine = sourceValues.get(parsed.key);
    return sourceLine ?? line;
  });
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const [key, line] of sourceValues) {
    if (!usedKeys.has(key)) lines.push(line);
  }
  return normalizeEnvText(lines.join("\n"));
}

function envValues(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const parsed = envLine(line);
    if (parsed && !blankEnvValue(parsed.value)) values.set(parsed.key, line);
  }
  return values;
}

function envLine(line: string) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (!match) return null;
  return { key: match[1], value: match[2] };
}

function blankEnvValue(value: string) {
  return value.trim() === "" || value.trim() === '""' || value.trim() === "''";
}

function normalizeEnvText(text: string) {
  return `${text.replace(/\n+$/g, "")}\n`;
}

export function crossDeviceLinkError(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { code?: string }).code === "EXDEV"
  );
}

async function projectEnvFiles(root: string) {
  if (runtimeManagedPath(root) && runtimeAgentSupported(process.platform)) {
    try {
      return await runtimeAgentClient().scanEnvFiles(root);
    } catch {}
  }
  const files = { runtime: [] as string[], templates: [] as string[] };
  await collectProjectEnvFiles(root, files);
  return files;
}

async function collectProjectEnvFiles(
  directory: string,
  files: { runtime: string[]; templates: string[] },
) {
  const entries = runtimeManagedPath(directory)
    ? await readRuntimeDirectory(directory)
    : await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = joinWorkspacePath(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredEnvDirectories.has(entry.name))
          await collectProjectEnvFiles(path, files);
        return;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) return;
      if (runtimeEnvFile(entry.name)) files.runtime.push(path);
      if (templateEnvFile(entry.name)) files.templates.push(path);
    }),
  );
}

function relativeWorkspacePath(root: string, path: string) {
  if (runtimeManagedPath(root)) return posix.relative(root, path);
  return relative(root, path).replace(/\\/g, "/");
}

async function readWorkspaceEnvFile(path: string) {
  if (runtimeManagedPath(path)) return readRuntimeFile(path);
  return readFile(path, "utf8");
}

async function writeWorkspaceEnvFile(path: string, content: string) {
  if (!runtimeManagedPath(path)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    return;
  }
  await mkdirRuntime(dirnameWorkspacePath(path));
  await writeRuntimeFile(path, content);
}

function runtimeEnvFile(name: string) {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return !envTemplateSuffixes.some((suffix) => name.endsWith(suffix));
}

function templateEnvFile(name: string) {
  if (!name.startsWith(".env")) return false;
  return envTemplateSuffixes.some((suffix) => name.endsWith(suffix));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
