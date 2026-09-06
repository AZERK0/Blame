import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { LightCommitService } from "./light-commit.js";
import { LightWorkspace } from "./light-workspace.js";
import { WorkspaceFiles } from "./workspace-files.js";

test("a new workspace restores an interrupted multi-file edit before reading", async () => {
  await fixture(async (root) => {
    await pendingWrite(root);
    await writeFile(join(root, "a.txt"), "new A");
    const workspace = new LightWorkspace(root, { sessionId: "recovery" });
    const result = await workspace.readCode(
      { target: "a.txt", view: "raw" },
      {},
    );
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.match(JSON.stringify(result), /old A/u);
    assert.equal(await readFile(join(root, "b.txt"), "utf8"), "old B");
    await assert.rejects(
      access(join(root, ".blame/harness/light-write/pending.json")),
    );
  });
});

test("recovery preserves a later external change instead of overwriting it", async () => {
  await fixture(async (root) => {
    await pendingWrite(root);
    await writeFile(join(root, "a.txt"), "external A");
    const commits = new LightCommitService(new WorkspaceFiles(root));
    await assert.rejects(
      commits.exclusive(async () => undefined),
      /newer change/u,
    );
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "external A");
    await access(join(root, ".blame/harness/light-write/pending.json"));
  });
});

test("harness readers wait until the whole batch is visible", async () => {
  await fixture(async (root) => {
    const workspace = new LightWorkspace(root, { sessionId: "reader" });
    await workspace.readCode({ target: "b.txt", view: "raw" }, {});
    const files = new WorkspaceFiles(root);
    const resolve = files.resolveForWriteVerified.bind(files);
    let release = () => {};
    let partial = () => {};
    const paused = new Promise<void>((resolve) => {
      partial = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    files.resolveForWriteVerified = async (path) => {
      if (path === "b.txt" && ++calls === 2) {
        partial();
        await resume;
      }
      return resolve(path);
    };
    const revision = (await files.snapshot()).revision.source_revision_id;
    const write = new LightCommitService(files).commit(mutations(), revision);
    await paused;
    let observed = false;
    const read = workspace
      .readCode({ target: "a.txt", view: "raw" }, {})
      .then((value) => {
        observed = true;
        return value;
      });
    await delay(30);
    assert.equal(observed, false);
    release();
    await write;
    assert.match(JSON.stringify(await read), /new A/u);
  });
});

function mutations() {
  return ["A", "B"].map((label) => ({
    path: `${label.toLowerCase()}.txt`,
    before: Buffer.from(`old ${label}`),
    after: Buffer.from(`new ${label}`),
  }));
}

async function pendingWrite(root: string) {
  const directory = join(root, ".blame/harness/light-write");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "pending.json"),
    JSON.stringify(
      mutations().map((mutation) => ({
        ...mutation,
        before: mutation.before.toString("base64"),
        after: mutation.after.toString("base64"),
      })),
    ),
  );
}

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-recovery-"));
  try {
    await writeFile(join(root, "a.txt"), "old A");
    await writeFile(join(root, "b.txt"), "old B");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
