import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  dependencyCachePopulated,
  dependencyCacheRoot,
  readDependencyCacheManifest,
} from "./dependency-cache.js";
import { DependencyEnvironmentService } from "./dependency-environment.js";
import type { TaskCatalogItem } from "./schemas.js";
import { WorkspaceFiles } from "./workspace-files.js";

const task: TaskCatalogItem = {
  task_id: "dependencies",
  kind: "dependencies",
  command: "pnpm install",
  cwd: ".",
  package_manager: "pnpm",
  package_manager_version: "10.33.2",
  supportsFileSelection: false,
  requiresNetwork: true,
  dependencyPolicy: "required",
};

test("empty dependency cache directories are never valid", async () => {
  const root = await fixture();
  try {
    const files = new WorkspaceFiles(root);
    const snapshot = await files.snapshot();
    const cache = await dependencyCacheRoot(root, snapshot.files, task);
    assert.equal(await dependencyCachePopulated(cache), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("persistent dependency environments require a fresh integrity probe", async () => {
  const root = await fixture();
  try {
    const files = new WorkspaceFiles(root);
    const snapshot = await files.snapshot();
    const service = new DependencyEnvironmentService(root);
    const persisted = await service.persist({
      files,
      snapshot,
      sourceWorkspace: root,
      task,
      resolvedVersion: "10.33.2",
      requiredPackages: ["fixture-package"],
    });
    assert.equal(persisted.integrity_probe.status, "passed");
    assert.equal(persisted.persistence?.strategy, "reflink_with_copy_fallback");
    assert.equal(persisted.persistence?.directories, 1);
    assert.equal(Number.isFinite(persisted.persistence?.duration_ms), true);
    const reused = await service.persist({
      files,
      snapshot,
      sourceWorkspace: root,
      task,
      resolvedVersion: "10.33.2",
      requiredPackages: ["fixture-package"],
    });
    assert.equal(reused.root, persisted.root);
    assert.deepEqual(reused.persistence, persisted.persistence);
    const cache = await dependencyCacheRoot(root, snapshot.files, task);
    assert.deepEqual(
      (await readDependencyCacheManifest(cache))?.persistence,
      persisted.persistence,
    );
    assert.equal(
      (await service.current(files, snapshot, task))?.spec
        .environment_revision_id,
      persisted.spec.environment_revision_id,
    );
    const link = join(persisted.workspace, "node_modules", ".bin", "fixture");
    assert.equal(await readlink(link), "../fixture-package/bin.js");
    await rm(join(persisted.workspace, "node_modules", "fixture-package"), {
      force: true,
      recursive: true,
    });
    assert.equal(await service.current(files, snapshot, task), undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dependency-environment-"));
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  await mkdir(join(root, "node_modules", "fixture-package"), {
    recursive: true,
  });
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { "fixture-package": "1.0.0" } }),
    ),
    writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
    writeFile(
      join(root, "node_modules", "fixture-package", "package.json"),
      JSON.stringify({ name: "fixture-package", main: "index.js" }),
    ),
    writeFile(
      join(root, "node_modules", "fixture-package", "index.js"),
      "export default true\n",
    ),
    writeFile(
      join(root, "node_modules", "fixture-package", "bin.js"),
      "#!/usr/bin/env node\n",
    ),
    writeFile(join(root, "node_modules", ".package-lock.json"), "{}\n"),
  ]);
  await symlink(
    "../fixture-package/bin.js",
    join(root, "node_modules", ".bin", "fixture"),
  );
  return root;
}
