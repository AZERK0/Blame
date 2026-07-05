import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";
import {
  ensureGitRepository,
  gitDiffBetween,
  isGitRepository,
  listGitDirectory,
  readGitFile,
} from "./workspace-git.ts";

const execFileAsync = promisify(execFile);

test("reads a merged story from Git history", async () => {
  const repository = await createRepository();
  try {
    const base = await revision(repository);
    await unlink(join(repository, "removed.txt"));
    await rm(join(repository, "removed"), { recursive: true });
    await mkdir(join(repository, "src"));
    await writeFile(join(repository, "src", "added.txt"), "added\n");
    await commit(repository, "story");
    const merge = await revision(repository);

    const diff = await gitDiffBetween({
      from: base,
      root: repository,
      to: merge,
    });
    const entries = await listGitDirectory({
      refs: [merge, base],
      root: repository,
    });
    const removed = await readGitFile({
      path: "removed.txt",
      refs: [merge, base],
      root: repository,
    });
    const removedDirectory = await listGitDirectory({
      path: "removed",
      refs: [merge, base],
      root: repository,
    });

    assert.match(diff, /removed\.txt/);
    assert.match(diff, /src\/added\.txt/);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["removed", "src", "removed.txt"],
    );
    assert.deepEqual(
      removedDirectory.map((entry) => entry.name),
      ["nested.txt"],
    );
    assert.equal(removed, "removed\n");
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

test("excludes runtime env files from Git history diffs", async () => {
  const repository = await createRepository();
  try {
    const base = await revision(repository);
    await writeFile(join(repository, ".env.test"), "DATABASE_URL=test\n");
    await writeFile(join(repository, ".env.example"), "DATABASE_URL=\n");
    await commit(repository, "env files");
    const merge = await revision(repository);

    const diff = await gitDiffBetween({
      from: base,
      root: repository,
      to: merge,
    });

    assert.doesNotMatch(diff, /\.env\.test/);
    assert.match(diff, /\.env\.example/);
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

test("rejects unsafe Git history inputs", async () => {
  const repository = await createRepository();
  try {
    const ref = await revision(repository);
    await assert.rejects(
      listGitDirectory({ path: "../outside", refs: [ref], root: repository }),
      /Path escapes workspace/,
    );
    await assert.rejects(
      readGitFile({ path: "removed.txt", refs: ["--help"], root: repository }),
      /Invalid Git revision/,
    );
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

test("initializes an opened folder that only belongs to a parent repository", async () => {
  const parentRepository = await createRepository();
  const openedFolder = join(parentRepository, "opened-project");
  try {
    await mkdir(openedFolder);
    await writeFile(
      join(openedFolder, "package.json"),
      '{"name":"opened-project"}\n',
    );

    assert.equal(await isGitRepository(openedFolder), false);
    assert.equal(await ensureGitRepository(openedFolder), true);

    const { stdout } = await git(openedFolder, [
      "rev-parse",
      "--show-toplevel",
    ]);
    assert.equal(stdout.trim(), openedFolder);
    assert.equal(await isGitRepository(openedFolder), true);
  } finally {
    await rm(parentRepository, { force: true, recursive: true });
  }
});

test("keeps an existing repository unchanged", async () => {
  const repository = await createRepository();
  try {
    assert.equal(await ensureGitRepository(repository), false);
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

async function createRepository() {
  const repository = await mkdtemp(join(tmpdir(), "blame-workspace-git-"));
  await git(repository, ["init"]);
  await git(repository, ["config", "user.email", "test@blame.local"]);
  await git(repository, ["config", "user.name", "Blame Test"]);
  await writeFile(join(repository, "removed.txt"), "removed\n");
  await mkdir(join(repository, "removed"));
  await writeFile(join(repository, "removed", "nested.txt"), "nested\n");
  await commit(repository, "base");
  return repository;
}

async function commit(repository: string, message: string) {
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", message]);
}

async function revision(repository: string) {
  const { stdout } = await git(repository, ["rev-parse", "HEAD"]);
  return stdout.trim();
}

function git(repository: string, args: string[]) {
  return execFileAsync("git", args, { cwd: repository });
}
