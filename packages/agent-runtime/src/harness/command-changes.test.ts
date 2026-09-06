import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { LightWorkspace } from "./light-workspace.js";
import { LightFinishService } from "./light-finish-service.js";
import { SessionJournal } from "./session-journal.js";

test("a short generator creates source without pretending to validate it", async () => {
  await fixture(async (root, workspace) => {
    const command = nodeCommand(
      "require('fs').writeFileSync('generated.js', 'module.exports = ' + JSON.stringify(Array.from({length:120}, (_, i) => i)) + ';\\n')",
    );
    const result = await workspace.runTask(
      { kind: "command", command },
      {} as never,
    );
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.match(JSON.stringify(result), /"changed":true/u);
    assert.match(JSON.stringify(result), /"status":"stale"/u);
    const state = await journal(root);
    assert.deepEqual(state.changedPaths, ["generated.js"]);
    assert.equal(state.validations.length, 0);
    assert.match(await readFile(join(root, "generated.js"), "utf8"), /119/u);
  });
});

test("commands preserve the initial state when a tracked file is changed and reverted", async () => {
  await fixture(async (root, workspace) => {
    await workspace.runTask(
      { kind: "command", command: writeValue(2) },
      {} as never,
    );
    assert.deepEqual((await journal(root)).changedPaths, ["value.js"]);
    await workspace.runTask(
      { kind: "command", command: writeValue(1) },
      {} as never,
    );
    assert.deepEqual((await journal(root)).changedPaths, []);
  });
});

test("a pre-existing dirty change is not claimed by a command round trip", async () => {
  await fixture(async (root, workspace) => {
    await writeFile(join(root, "value.js"), "module.exports = 5;\n");
    await workspace.runTask(
      { kind: "command", command: writeValue(6) },
      {} as never,
    );
    await workspace.runTask(
      { kind: "command", command: writeValue(5) },
      {} as never,
    );
    assert.deepEqual((await journal(root)).changedPaths, []);
    assert.equal(
      await readFile(join(root, "value.js"), "utf8"),
      "module.exports = 5;\n",
    );
  });
});

test("source effects remain visible after a command fails", async () => {
  await fixture(async (root, workspace) => {
    const command = nodeCommand(
      "require('fs').writeFileSync('value.js', 'module.exports = 2;\\n'); process.exit(1)",
    );
    const result = await workspace.runTask(
      { kind: "command", command },
      {} as never,
    );
    assert.equal(result.status, "blocked");
    assert.deepEqual((await journal(root)).changedPaths, ["value.js"]);
    assert.equal((await journal(root)).validations.length, 0);
  });
});

test("a project formatter is followed by a check on the resulting source", async () => {
  await fixture(async (root, workspace) => {
    const manifest = {
      scripts: { build: "node --version", format: writeValue(2) },
    };
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    const result = await workspace.runTask(
      { kind: "project", task: "format" },
      {} as never,
    );
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual((await journal(root)).changedPaths, ["value.js"]);
    let verified = false;
    await new LightFinishService({
      workspaceRoot: root,
      conversationId: "commands",
      onComplete: (value) => {
        verified = value.verified;
      },
    }).finish("Formatted", {} as never);
    assert.equal(verified, true);
    assert.equal((await journal(root)).validations.at(-1)?.taskId, "build");
  });
});

test("source effects remain visible when a running command is cancelled", async () => {
  await fixture(async (root, workspace) => {
    const controller = new AbortController();
    const command = nodeCommand(
      "const fs = require('fs'); fs.writeFileSync('value.js', 'module.exports = 2;\\n'); fs.writeFileSync('.blame/observed', 'yes'); setTimeout(() => {}, 2000)",
    );
    const pending = workspace.runTask({ kind: "command", command }, {
      signal: controller.signal,
    } as never);
    await waitFor(join(root, ".blame/observed"));
    controller.abort();
    assert.equal((await pending).status, "blocked");
    assert.deepEqual((await journal(root)).changedPaths, ["value.js"]);
  });
});

function writeValue(value: number) {
  return nodeCommand(
    `require('fs').writeFileSync('value.js', 'module.exports = ${value};\\n')`,
  );
}

function nodeCommand(script: string) {
  return `node -e '${script.replaceAll("'", "'\\''")}'`;
}

function journal(root: string) {
  return new SessionJournal(root, "commands").completionSnapshot();
}

async function fixture(
  run: (root: string, workspace: LightWorkspace) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "blame-command-changes-"));
  try {
    await writeFile(join(root, "value.js"), "module.exports = 1;\n");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { build: "node --version" } }),
    );
    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    await mkdir(join(root, ".blame"));
    await run(root, new LightWorkspace(root, { sessionId: "commands" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function git(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: "ignore",
  });
}

async function waitFor(path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return;
    await delay(10);
  }
  throw new Error("The command did not reach its source write.");
}
