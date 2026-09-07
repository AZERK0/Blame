import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("terminating a semantic runner cancels its detached workspace command", {
  skip: process.platform === "win32", timeout: 10_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-runner-signal-"));
  let runner: ChildProcess | undefined;
  let commandPid: number | undefined;
  try {
    await writeFile(join(root, "child.cjs"), 'require("node:fs").writeFileSync("child.pid", String(process.pid)); setInterval(() => {}, 1000);');
    runner = startRunner(root);
    const closed = once(runner, "close");
    commandPid = await waitForPid(join(root, "child.pid"));
    runner.kill("SIGTERM");
    const [code] = await closed;
    await waitForStopped(commandPid);
    assert.equal(await running(commandPid), false, "The workspace command survived runner cancellation");
    assert.equal(code, 1);
  } finally {
    if (commandPid && await running(commandPid)) terminate(commandPid);
    if (runner?.pid && runner.exitCode === null && runner.signalCode === null) terminate(runner.pid);
    await rm(root, { recursive: true, force: true });
  }
});

function startRunner(root: string) {
  const path = fileURLToPath(new URL("./semantic-harness-runner.js", import.meta.url));
  const runner = spawn(process.execPath, [path], { cwd: root, stdio: ["pipe", "ignore", "ignore"] });
  runner.stdin.end(JSON.stringify({
    workspaceRoot: root, tool: "run_task", input: { kind: "command", command: "node child.cjs" },
    taskContract: { session_id: "signal-test", environment: { isolated: true, managedPreview: false } },
  }));
  return runner;
}

async function waitForPid(path: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await readFile(path, "utf8").catch(() => "");
    if (/^\d+$/u.test(value)) return Number(value);
    await delay(20);
  }
  throw new Error("Workspace command did not start");
}

async function waitForStopped(pid: number) {
  for (let attempt = 0; attempt < 50 && await running(pid); attempt += 1)
    await delay(20);
}

async function running(pid: number) {
  try { process.kill(pid, 0); } catch { return false; }
  if (process.platform !== "linux") return true;
  const status = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
  return Boolean(status) && !/^\d+ \(.*\) Z /u.test(status);
}

function terminate(pid: number) {
  try { process.kill(pid, "SIGKILL"); } catch { return; }
}
