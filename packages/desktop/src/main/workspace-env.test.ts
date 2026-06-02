import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyProjectEnvFiles, mergeEnvValues } from "./workspace-env.ts";

test("copies runtime env files from repository root and fills blank worktree values", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-env-source-"));
  const worktree = await mkdtemp(join(tmpdir(), "blame-env-worktree-"));

  try {
    await writeFile(
      join(root, ".env"),
      "ROOT_SECRET=source\nONLY_SOURCE=source\n",
    );
    await writeFile(join(root, ".env.example"), "ROOT_SECRET=\n");
    await writeFile(join(root, ".env.local"), "LOCAL_SECRET=source\n");
    await mkdir(join(root, "apps", "backend"), { recursive: true });
    await mkdir(join(root, "apps", "extension", "dist"), {
      recursive: true,
    });
    await writeFile(
      join(root, "apps", "backend", ".env"),
      "BACKEND_SECRET=source\n",
    );
    await writeFile(
      join(root, "apps", "extension", "dist", ".env"),
      "DIST_SECRET=source\n",
    );
    await writeFile(
      join(worktree, ".env"),
      "ROOT_SECRET=\nWORKTREE_SECRET=worktree\n",
    );

    await copyProjectEnvFiles(root, worktree);

    assert.equal(
      await readFile(join(worktree, ".env"), "utf8"),
      "ROOT_SECRET=source\nWORKTREE_SECRET=worktree\nONLY_SOURCE=source\n",
    );
    assert.equal(
      await readFile(join(worktree, ".env.local"), "utf8"),
      "LOCAL_SECRET=source\n",
    );
    assert.equal(
      await readFile(join(worktree, "apps", "backend", ".env"), "utf8"),
      "BACKEND_SECRET=source\n",
    );
    await assert.rejects(
      () => stat(join(worktree, "apps", "extension", "dist", ".env")),
      /ENOENT/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(worktree, { force: true, recursive: true });
  }
});

test("merges env values without replacing existing non-empty values", () => {
  const source = "A=source\nB=source\nC=source\n";
  const destination = "A=worktree\nB=\nD=worktree\n";

  assert.equal(
    mergeEnvValues(source, destination),
    "A=worktree\nB=source\nD=worktree\nC=source\n",
  );
});
