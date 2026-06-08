import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

const ignoredEnvDirectories = new Set([
  ".git",
  ".blame",
  ".blame-worktrees",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const envTemplateSuffixes = [".example", ".sample", ".template"];

export async function syncProjectEnvFiles(
  repositoryRoot: string,
  worktree: string,
) {
  const files = await prepareProjectEnvFiles(repositoryRoot);
  await Promise.all(
    files.map((path) => linkWorktreeEnvFile(repositoryRoot, worktree, path)),
  );
}

async function linkWorktreeEnvFile(
  repositoryRoot: string,
  worktree: string,
  sourcePath: string,
) {
  const destinationPath = join(worktree, relative(repositoryRoot, sourcePath));
  if (await sameFile(sourcePath, destinationPath)) return;
  if (await pathExists(destinationPath)) {
    await mergeEnvFileValues(destinationPath, sourcePath);
    await rm(destinationPath, { force: true });
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  await link(sourcePath, destinationPath);
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

async function projectEnvFiles(root: string) {
  const files = { runtime: [] as string[], templates: [] as string[] };
  await collectProjectEnvFiles(root, files);
  return files;
}

async function collectProjectEnvFiles(
  directory: string,
  files: { runtime: string[]; templates: string[] },
) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredEnvDirectories.has(entry.name))
          await collectProjectEnvFiles(path, files);
        return;
      }
      if (!entry.isFile()) return;
      if (runtimeEnvFile(entry.name)) files.runtime.push(path);
      if (templateEnvFile(entry.name)) files.templates.push(path);
    }),
  );
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
