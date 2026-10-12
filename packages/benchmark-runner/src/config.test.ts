import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseBenchmarkCommand } from "./config.js";

test("selects the requested benchmark harness", async () => {
  await withInstruction(async (directory, instructionPath) => {
    const base = await parseBenchmarkCommand(
      ["run", "--instruction-file", instructionPath],
      environment(),
      directory,
    );
    const cline = await parseBenchmarkCommand(
      ["run", "--instruction-file", instructionPath, "--harness", "cline"],
      environment(),
      directory,
    );
    assert.equal(base.config.harness, "blame");
    assert.equal(cline.config.harness, "cline");
  });
});

test("rejects an unknown benchmark harness", async () => {
  await withInstruction(async (directory, instructionPath) => {
    await assert.rejects(
      parseBenchmarkCommand(
        ["run", "--instruction-file", instructionPath, "--harness", "unknown"],
        environment(),
        directory,
      ),
      /Invalid harness: unknown/u,
    );
  });
});

test("loads bounded literal required checks and rejects command-shaped metadata", async () => {
  await withInstruction(async (directory, instructionPath) => {
    const checksPath = join(directory, "checks.json");
    const checks = [{ id: "selected", task: "test", args: ["some.test.ts", "--test-name-pattern=literal value"] }];
    await writeFile(checksPath, JSON.stringify(checks));
    const args = ["run", "--instruction-file", instructionPath, "--required-checks-file", checksPath];
    assert.deepEqual((await parseBenchmarkCommand(args, environment(), directory)).config.requiredChecks, checks);
    await writeFile(checksPath, JSON.stringify([{ ...checks[0], command: "echo untrusted" }]));
    await assert.rejects(parseBenchmarkCommand(args, environment(), directory));
  });
});

test("passes an optional project identity to longitudinal runs", async () => {
  await withInstruction(async (directory, instructionPath) => {
    const parsed = await parseBenchmarkCommand(
      [
        "run",
        "--instruction-file",
        instructionPath,
        "--project-id",
        "project-1",
      ],
      environment(),
      directory,
    );
    assert.equal(parsed.config.projectId, "project-1");
  });
});

async function withInstruction(
  action: (directory: string, instructionPath: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-config-"));
  const instructionPath = join(directory, "instruction.md");
  await writeFile(instructionPath, "Change the greeting", "utf8");
  try {
    await action(directory, instructionPath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function environment() {
  return {
    BLAME_API_TOKEN: "token",
    BLAME_API_URL: "https://api.example.test",
    BLAME_HEADLESS_DEV: "true",
    BLAME_MODEL_ID: "model",
    BLAME_PROVIDER_ID: "provider",
    NODE_ENV: "development",
  };
}

test("isolation is an explicit caller assertion with a conservative default", async () => {
  await withInstruction(async (directory, instructionPath) => {
    const args = ["run", "--instruction-file", instructionPath];
    for (const value of [undefined, "false", "true"]) {
      const parsed = await parseBenchmarkCommand(args,
        { ...environment(), BLAME_ISOLATED_ENVIRONMENT: value }, directory);
      assert.equal(parsed.config.isolatedEnvironment, value === "true");
    }
    await assert.rejects(parseBenchmarkCommand(args,
      { ...environment(), BLAME_ISOLATED_ENVIRONMENT: "yes" }, directory),
    /BLAME_ISOLATED_ENVIRONMENT must be true or false/);
  });
});
