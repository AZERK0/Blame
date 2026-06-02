import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

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

export async function copyProjectEnvFiles(
  repositoryRoot: string,
  worktree: string,
) {
  const files = await projectEnvFiles(repositoryRoot);
  await Promise.all(
    files.map((path) => copyMissingEnvFile(repositoryRoot, worktree, path)),
  );
}

async function copyMissingEnvFile(
  repositoryRoot: string,
  worktree: string,
  sourcePath: string,
) {
  const destinationPath = join(worktree, relative(repositoryRoot, sourcePath));
  if (await fileExists(destinationPath)) {
    await mergeEnvFileValues(sourcePath, destinationPath);
    return;
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
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
  const files: string[] = [];
  await collectProjectEnvFiles(root, files);
  return files;
}

async function collectProjectEnvFiles(directory: string, files: string[]) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredEnvDirectories.has(entry.name))
          await collectProjectEnvFiles(path, files);
        return;
      }
      if (entry.isFile() && runtimeEnvFile(entry.name)) files.push(path);
    }),
  );
}

function runtimeEnvFile(name: string) {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return !envTemplateSuffixes.some((suffix) => name.endsWith(suffix));
}

async function fileExists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
