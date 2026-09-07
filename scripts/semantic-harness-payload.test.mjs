import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  realpath,
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
import { buildSemanticHarnessPayload, runtimeCorePackagePath } from "./semantic-harness-payload.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const agentRuntimeDir = join(rootDir, "packages/agent-runtime");

test("standalone payload executes navigation and command dependencies", async () => {
  await withPayload(async (packageRoot, workspaceRoot) => {
    await assert.rejects(access(join(packageRoot, "harness/semantic-workspace.js")));
    const result = await executeRunner(packageRoot, workspaceRoot);
    assert.equal(result.status, "ok");
    assert.match(result.data.description, /Symbol read\/edit/u);
    const command = await executeRunner(packageRoot, workspaceRoot, {
      tool: "run_task", input: { kind: "command", command: "node -e \"console.log('payload-ready')\"" },
    });
    assert.equal(command.status, "ok", JSON.stringify(command));
    assert.match(command.data.output, /payload-ready/);
  });
});

async function withPayload(action) {
  const temporary = await mkdtemp(join(tmpdir(), "semantic-payload-test-"));
  try {
    const archive = join(temporary, "semantic-harness.tgz");
    const installRoot = join(temporary, "install");
    const workspaceRoot = join(temporary, "workspace");
    await buildSemanticHarnessPayload({ outputPaths: [archive], runtimeVersion: "payload-test" });
    await extractArchive(archive, installRoot);
    const packageRoot = join(installRoot, "package");
    await linkRuntimeDependencies(packageRoot);
    await mkdir(workspaceRoot);
    await writeFile(join(workspaceRoot, "package.json"), '{"scripts":{}}\n');
    await action(packageRoot, workspaceRoot);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

async function extractArchive(archive, destination) {
  await mkdir(destination);
  await runProcess("tar", ["-xzf", archive, "-C", destination]);
}

async function linkRuntimeDependencies(packageRoot) {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const coreRoot = await runtimeCorePackagePath();
  const dependencyRoot = dirname(dirname(coreRoot));
  for (const name of Object.keys(manifest.dependencies)) {
    const destination = join(packageRoot, "node_modules", name);
    const source = await dependencyPath(name, dependencyRoot);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(source, destination, process.platform === "win32" ? "junction" : undefined);
  }
}

async function dependencyPath(name, coreDependencies) {
  try { return await realpath(join(agentRuntimeDir, "node_modules", name)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return realpath(join(coreDependencies, name));
}

async function executeRunner(packageRoot, workspaceRoot, request = {}) {
  const stdout = await runProcess(
    process.execPath,
    [join(packageRoot, "harness/semantic-harness-runner.js")],
    JSON.stringify({
      input: { target: "@capabilities" },
      taskContract: { session_id: "payload-e2e" },
      tool: "read_code",
      workspaceRoot,
      ...request,
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
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8")));
    });
    child.stdin.end(input);
  });
}

test("standalone payload returns image media with the forwarded model capability", async () => {
  await withPayload(async (packageRoot, workspaceRoot) => {
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=", "base64");
    await writeFile(join(workspaceRoot, "pixel.png"), pixel);
    const result = await executeRunner(packageRoot, workspaceRoot, {
      input: { target: "pixel.png" }, toolContext: { metadata: { modelSupportsImages: true } },
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(result.content, [{ type: "image", mediaType: "image/png", data: pixel.toString("base64") }]);
  });
});

test("standalone payload ships the patched SDK used by the managed hub", async () => {
  await withPayload(async (packageRoot) => {
    const entry = join(packageRoot, "vendor/cline-core/dist/index.js");
    const sdk = await import(pathToFileURL(entry).href);
    const config = { providerId: "anthropic", modelId: "fixture", compaction: { enabled: true, strategy: "basic", imageTokenLimit: 36000 } };
    const messages = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: [
      { type: "text", text: "Inspect the input." },
      { type: "image", mediaType: "image/png", data: "A".repeat(600000) },
    ] }));
    const prepare = sdk.createContextCompactionPrepareTurn(sdk.splitCoreSessionConfig(config).config);
    const result = await prepare({ messages, apiMessages: messages, systemPrompt: "", tools: [],
      abortSignal: new AbortController().signal, agentId: "fixture", conversationId: "fixture", parentAgentId: null, iteration: 1,
      model: { id: "fixture", provider: "anthropic", info: { maxInputTokens: 922000, contextWindow: 1050000 } },
    });
    assert.equal(result, undefined);
    assert.match(sdk.resolveHubBuildId(), /^blame-sdk-image-budget-v1-/);
  });
});
