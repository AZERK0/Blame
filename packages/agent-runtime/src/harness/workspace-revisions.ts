import { access } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./light-identity.js";
import { WorkspaceFiles } from "./workspace-files.js";

export type WorkspaceRevisionState = {
  dependencies_ready: boolean;
  environment_revision_id: string;
  source_revision_id: string;
};

export async function currentWorkspaceRevisionState(workspaceRoot: string) {
  const files = new WorkspaceFiles(workspaceRoot);
  const snapshot = await files.snapshot();
  return {
    dependencies_ready: await dependenciesReady(files, snapshot.files),
    environment_revision_id: await environmentRevision(files, snapshot.files),
    source_revision_id: snapshot.revision.source_revision_id,
  } satisfies WorkspaceRevisionState;
}

async function environmentRevision(files: WorkspaceFiles, paths: string[]) {
  const entries = await Promise.all(
    paths.filter(environmentPath).map(async (path) => {
      const content = (await files.read(path)).content;
      return `${path}\0${sha256(content)}`;
    }),
  );
  return `env_${sha256(entries.sort().join("\n")).slice(0, 32)}`;
}

async function dependenciesReady(files: WorkspaceFiles, paths: string[]) {
  const manifests = paths.filter((path) => path.endsWith("package.json"));
  if (!(await hasDeclaredDependencies(files, manifests))) return true;
  try {
    await access(join(files.root, "node_modules"));
    return true;
  } catch {
    return false;
  }
}

async function hasDeclaredDependencies(
  files: WorkspaceFiles,
  manifests: string[],
) {
  for (const path of manifests) {
    try {
      const manifest = JSON.parse((await files.read(path)).content.toString());
      const sections = [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ];
      if (
        sections.some((section) => Object.keys(manifest[section] ?? {}).length)
      )
        return true;
    } catch {
      return true;
    }
  }
  return false;
}

function environmentPath(path: string) {
  return (
    path.endsWith("package.json") ||
    /(?:^|\/)(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(
      path,
    )
  );
}
