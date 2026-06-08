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
import { mergeEnvValues, syncProjectEnvFiles } from "./workspace-env.ts";

test("links runtime env files from repository root and fills blank main values", async () => {
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

    await syncProjectEnvFiles(root, worktree);

    assert.equal(
      await readFile(join(worktree, ".env"), "utf8"),
      "ROOT_SECRET=source\nONLY_SOURCE=source\nWORKTREE_SECRET=worktree\n",
    );
    assert.equal(
      await readFile(join(root, ".env"), "utf8"),
      "ROOT_SECRET=source\nONLY_SOURCE=source\nWORKTREE_SECRET=worktree\n",
    );
    await assertSameFile(join(root, ".env"), join(worktree, ".env"));
    assert.equal(
      await readFile(join(worktree, ".env.local"), "utf8"),
      "LOCAL_SECRET=source\n",
    );
    await assertSameFile(
      join(root, ".env.local"),
      join(worktree, ".env.local"),
    );
    assert.equal(
      await readFile(join(worktree, "apps", "backend", ".env"), "utf8"),
      "BACKEND_SECRET=source\n",
    );
    await writeFile(join(worktree, ".env"), "ROOT_SECRET=edited\n");
    assert.equal(
      await readFile(join(root, ".env"), "utf8"),
      "ROOT_SECRET=edited\n",
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

test("creates main runtime env files from templates before linking", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-env-template-source-"));
  const worktree = await mkdtemp(
    join(tmpdir(), "blame-env-template-worktree-"),
  );

  try {
    await writeFile(join(root, ".env.example"), "SECRET=template\n");
    await writeFile(join(root, ".env.local.example"), "LOCAL=template\n");

    await syncProjectEnvFiles(root, worktree);

    assert.equal(
      await readFile(join(root, ".env"), "utf8"),
      "SECRET=template\n",
    );
    assert.equal(
      await readFile(join(root, ".env.local"), "utf8"),
      "LOCAL=template\n",
    );
    await assertSameFile(join(root, ".env"), join(worktree, ".env"));
    await assertSameFile(
      join(root, ".env.local"),
      join(worktree, ".env.local"),
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

async function assertSameFile(left: string, right: string) {
  const [leftStat, rightStat] = await Promise.all([stat(left), stat(right)]);
  assert.equal(leftStat.dev, rightStat.dev);
  assert.equal(leftStat.ino, rightStat.ino);
}
