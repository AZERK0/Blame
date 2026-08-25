import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskCatalogItem } from "./schemas.js";

const dependencyFiles =
  /(^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|pnpm-workspace\.yaml)$/u;

export async function dependencyCacheRoot(
  workspaceRoot: string,
  files: string[],
  task: TaskCatalogItem,
) {
  const digest = createHash("sha256");
  digest.update(
    `${task.package_manager}@${task.package_manager_version ?? "default"}\0`,
  );
  const relevant = files.filter((path) => dependencyFiles.test(path)).sort();
  for (const path of relevant) {
    digest.update(path);
    digest.update("\0");
    digest.update(await readFile(join(workspaceRoot, path)));
    digest.update("\0");
  }
  const root = join(
    workspaceRoot,
    ".blame",
    "harness",
    "dependency-cache",
    task.package_manager,
    digest.digest("hex"),
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}
