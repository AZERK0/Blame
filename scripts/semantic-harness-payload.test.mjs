import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildSemanticHarnessPayload } from "./semantic-harness-payload.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const agentRuntimeDir = join(rootDir, "packages/agent-runtime");

test("standalone payload executes the canonical workspace bridge", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "semantic-payload-test-"));
  try {
    const archive = join(temporary, "semantic-harness.tgz");
    const installRoot = join(temporary, "install");
    const workspaceRoot = join(temporary, "workspace");
    await buildSemanticHarnessPayload({
      outputPaths: [archive],
      runtimeVersion: "payload-test",
    });
    await extractArchive(archive, installRoot);
    const packageRoot = join(installRoot, "package");
    await linkRuntimeDependencies(packageRoot);
    await access(
      join(packageRoot, "node_modules/@blame/harness-core/dist/index.js"),
    );
    await mkdir(workspaceRoot);
    await writeFile(join(workspaceRoot, "package.json"), '{"scripts":{}}\n');
    const result = await executeRunner(packageRoot, workspaceRoot);
    assert.equal(result.protocol_version, "3");
    assert.equal(result.outcome, "completed");
    assert.equal(result.effect, "observed");
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});

async function extractArchive(archive, destination) {
  await mkdir(destination);
  await runProcess("tar", ["-xzf", archive, "-C", destination]);
}

async function linkRuntimeDependencies(packageRoot) {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const dependencies = Object.keys(manifest.dependencies).filter(
    (name) => name !== "@blame/harness-core",
  );
  for (const name of dependencies) {
    const destination = join(packageRoot, "node_modules", name);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(
      join(agentRuntimeDir, "node_modules", name),
      destination,
      process.platform === "win32" ? "junction" : undefined,
    );
  }
}

async function executeRunner(packageRoot, workspaceRoot) {
  const stdout = await runProcess(
    process.execPath,
    [join(packageRoot, "harness/semantic-harness-runner.js")],
    JSON.stringify({
      input: {},
      tool: "workspace_state",
      toolContext: { executionId: "payload-e2e" },
      workspaceRoot,
    }),
  );
  return JSON.parse(stdout);
}

function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8")));
    });
    child.stdin.end(input);
  });
}
