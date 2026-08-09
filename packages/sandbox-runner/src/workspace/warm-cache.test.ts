import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  refreshWorkspacePreservingWarmCaches,
  warmCacheDirectories,
} from "./warm-cache.js";

test("restores only recognized compiler caches after a canonical refresh", async () => {
  const parent = await mkdtemp(join(tmpdir(), "blame-warm-cache-test-"));
  const root = join(parent, "workspace");
  try {
    await mkdir(join(root, "packages/web/.next/cache"), { recursive: true });
    await mkdir(join(root, "packages/app/.vite"), { recursive: true });
    await mkdir(join(root, "node_modules/.bin"), { recursive: true });
    await mkdir(join(root, "packages/web/node_modules"), { recursive: true });
    await mkdir(join(root, "packages/api/dist"), { recursive: true });
    await writeFile(join(root, "tracked.ts"), "mutated");
    await writeFile(
      join(root, "packages/web/.next/cache/compiler.bin"),
      "next-cache",
    );
    await writeFile(join(root, "packages/app/.vite/deps.json"), "vite-cache");
    await writeFile(join(root, "node_modules/.bin/next"), "next-binary");
    await writeFile(
      join(root, "packages/web/node_modules/workspace-package"),
      "workspace-link",
    );
    await writeFile(join(root, "packages/api/dist/server.js"), "generated");

    const refreshed = await refreshWorkspacePreservingWarmCaches(async () => {
      await rm(root, { recursive: true, force: true });
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "tracked.ts"), "canonical");
      return "refreshed";
    }, root);

    assert.deepEqual(refreshed, {
      cachePaths: [
        "node_modules",
        "packages/app/.vite",
        "packages/web/.next/cache",
        "packages/web/node_modules",
      ],
      result: "refreshed",
    });
    assert.equal(await readFile(join(root, "tracked.ts"), "utf8"), "canonical");
    assert.equal(
      await readFile(
        join(root, "packages/web/.next/cache/compiler.bin"),
        "utf8",
      ),
      "next-cache",
    );
    assert.equal(
      await readFile(join(root, "packages/app/.vite/deps.json"), "utf8"),
      "vite-cache",
    );
    assert.equal(
      await readFile(join(root, "node_modules/.bin/next"), "utf8"),
      "next-binary",
    );
    assert.equal(
      await readFile(
        join(root, "packages/web/node_modules/workspace-package"),
        "utf8",
      ),
      "workspace-link",
    );
    await assert.rejects(() =>
      readFile(join(root, "packages/api/dist/server.js")),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("does not traverse symlinked cache directories", async () => {
  const parent = await mkdtemp(
    join(tmpdir(), "blame-warm-cache-symlink-test-"),
  );
  const root = join(parent, "workspace");
  try {
    await mkdir(join(root, "packages/web"), { recursive: true });
    await mkdir(join(parent, "outside-cache"), { recursive: true });
    await symlink(
      join(parent, "outside-cache"),
      join(root, "packages/web/.next"),
    );
    assert.deepEqual(await warmCacheDirectories(root), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("restores dependencies when the canonical refresh fails", async () => {
  const parent = await mkdtemp(join(tmpdir(), "blame-warm-cache-failure-"));
  const root = join(parent, "workspace");
  try {
    await mkdir(join(root, "node_modules/.bin"), { recursive: true });
    await writeFile(join(root, "node_modules/.bin/next"), "next-binary");

    await assert.rejects(
      refreshWorkspacePreservingWarmCaches(async () => {
        throw new Error("refresh failed");
      }, root),
      /refresh failed/,
    );
    assert.equal(
      await readFile(join(root, "node_modules/.bin/next"), "utf8"),
      "next-binary",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
