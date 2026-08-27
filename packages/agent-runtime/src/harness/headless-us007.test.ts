import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { BlameAgentRuntime } from "../cline-runtime.js";
import type { AgentEvent } from "../types.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { resolvePackageManager } from "./package-manager-runtime.js";

const enabled = process.env.BLAME_HEADLESS_US007 === "true";
const fixture = fileURLToPath(
  new URL("../../test-fixtures/us-007-headless", import.meta.url),
);

test(
  "GPT-5.6 Sol X-high completes the US-007 fixture through real tool streaming",
  { skip: !enabled, timeout: 3_600_000 },
  async () => {
    const configuration = headlessConfiguration();
    assert.match(configuration.modelId, /gpt-?5\.6.*sol/iu);
    for (let index = 0; index < 3; index += 1)
      await runHeadlessStory(configuration, index);
  },
);

function headlessConfiguration() {
  return {
    apiUrl: requiredEnvironment("BLAME_HEADLESS_API_URL"),
    apiToken: requiredEnvironment("BLAME_HEADLESS_API_TOKEN"),
    providerId: requiredEnvironment("BLAME_HEADLESS_PROVIDER_ID"),
    modelId: requiredEnvironment("BLAME_HEADLESS_MODEL_ID"),
    credentialLabel: process.env.BLAME_HEADLESS_CREDENTIAL_LABEL,
  };
}

async function runHeadlessStory(
  configuration: ReturnType<typeof headlessConfiguration>,
  index: number,
) {
  const root = await prepareFixture(index);
  const streamedEvents: AgentEvent[] = [];
  const { runtime, terminalEvent } = headlessRuntime(streamedEvents);
  try {
    const session = await startHeadlessSession(
      runtime,
      configuration,
      root,
      index,
    );
    const ended = await terminalEvent;
    assert.equal(ended.type, "done", JSON.stringify(ended.payload));
    await assertHeadlessResult(
      runtime,
      root,
      session.sessionId,
      streamedEvents,
    );
  } finally {
    await runtime.sessions.releaseWorkspace(root).catch(() => undefined);
    await rm(root, { force: true, recursive: true });
  }
}

function headlessRuntime(streamedEvents: AgentEvent[]) {
  let terminal: ((event: AgentEvent) => void) | undefined;
  const terminalEvent = new Promise<AgentEvent>((resolve) => {
    terminal = resolve;
  });
  const runtime = new BlameAgentRuntime({
    emit(event) {
      streamedEvents.push(event);
      if (event.type === "done" || event.type === "error") terminal?.(event);
    },
  });
  return { runtime, terminalEvent };
}

function startHeadlessSession(
  runtime: BlameAgentRuntime,
  configuration: ReturnType<typeof headlessConfiguration>,
  root: string,
  index: number,
) {
  return runtime.sessions.startDevelopment({
    apiConnection: {
      url: configuration.apiUrl,
      token: configuration.apiToken,
    },
    providerId: configuration.providerId,
    modelId: configuration.modelId,
    credentialLabel: configuration.credentialLabel,
    reasoningEffort: "xhigh",
    title: "US-007 harness finalization fixture",
    summary: storyPrompt,
    cwd: root,
    workspaceRoot: root,
    workspaceMode: "cloud-mirror",
    backend: { mode: "local" },
    executionId: `headless-us007-${index}`,
    storyId: `US-007-headless-${index}`,
    maxIterations: 80,
  });
}

async function prepareFixture(index: number) {
  const root = await mkdtemp(join(tmpdir(), `blame-us007-${index}-`));
  await cp(fixture, root, {
    recursive: true,
    filter: (source) => !excludedFixturePath(source),
  });
  await installFixtureDependencies(root);
  await execa("git", ["init", "--initial-branch=main"], { cwd: root });
  await execa("git", ["config", "user.email", "headless@blame.test"], {
    cwd: root,
  });
  await execa("git", ["config", "user.name", "Blame Headless"], { cwd: root });
  await execa("git", ["add", "."], { cwd: root });
  await execa("git", ["commit", "-m", "fixture"], { cwd: root });
  return root;
}

async function installFixtureDependencies(root: string) {
  const manager = await resolvePackageManager({
    compatibility: "pnpm_same_major",
    name: "pnpm",
    version: "10.32.1",
  });
  await execa(
    manager.executable,
    [
      ...manager.argsPrefix,
      "install",
      "--frozen-lockfile",
      "--ignore-workspace",
    ],
    {
      cwd: root,
      env: {
        COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
        COREPACK_ENABLE_PROJECT_SPEC: "0",
        npm_config_manage_package_manager_versions: "false",
        pnpm_config_manage_package_manager_versions: "false",
      },
    },
  );
}

function excludedFixturePath(path: string) {
  return ["node_modules", ".blame", ".git"].includes(basename(path));
}

async function assertHeadlessResult(
  runtime: BlameAgentRuntime,
  root: string,
  sessionId: string,
  events: AgentEvent[],
) {
  const memory = new ConversationMemoryStore(root, sessionId);
  assert.equal((await memory.completionState()).requiredValidation, undefined);
  const runs = await storedRuns(root);
  assert.equal(runs.some(successfulBuild), true);
  assert.equal(
    runs.some((run) => /corepack/iu.test(JSON.stringify(run))),
    false,
  );
  const messages = await runtime.sessions.messages(sessionId);
  assertNoConsecutiveDuplicateCalls(messages, "fetch_web_content");
  assertNoConsecutiveDuplicateCalls(messages, "inspect_code");
  assert.equal(
    events.some((event) => event.type === "tool"),
    true,
  );
  assert.deepEqual(await abandonedTemporaryFiles(root), []);
}

async function storedRuns(root: string) {
  const directory = join(root, ".blame", "harness", "runs");
  const files = await readdir(directory);
  return Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) =>
        JSON.parse(await readFile(join(directory, file), "utf8")),
      ),
  ) as Promise<Array<Record<string, unknown>>>;
}

function successfulBuild(run: Record<string, unknown>) {
  const task = recordValue(run.task);
  return task.kind === "build" && run.status === "passed";
}

function assertNoConsecutiveDuplicateCalls(value: unknown, toolName: string) {
  const calls: string[] = [];
  collectToolCalls(value, toolName, calls);
  for (let index = 1; index < calls.length; index += 1)
    assert.notEqual(calls[index], calls[index - 1]);
}

function collectToolCalls(value: unknown, toolName: string, calls: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectToolCalls(item, toolName, calls);
    return;
  }
  const record = recordValue(value);
  if (!Object.keys(record).length) return;
  const name = record.toolName ?? record.name;
  if (name === toolName)
    calls.push(JSON.stringify(record.input ?? record.arguments ?? {}));
  for (const item of Object.values(record))
    collectToolCalls(item, toolName, calls);
}

async function abandonedTemporaryFiles(root: string) {
  const found: string[] = [];
  await walk(root, found);
  return found.filter((path) => /(?:\.tmp|\.bak|\.orig)$/iu.test(path));
}

async function walk(directory: string, found: string[]) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".blame", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, found);
    else if ((await stat(path)).isFile()) found.push(path);
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required when BLAME_HEADLESS_US007=true.`);
  return value;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const storyPrompt = [
  "Add an optional subtitle to the Prisma Project model and API response.",
  "Add an accent color to portfolio.jsonc and use the subtitle in the TSX page.",
  "Adjust the CSS for the subtitle without removing the existing title style.",
  "Use structured JSON editing, patch Prisma as validated text, and semantic TSX editing.",
  "Run validate:json, validate:prisma, typecheck, and the complete build after the final write.",
  "Finish only through submit_and_exit after the build has passed.",
].join(" ");
