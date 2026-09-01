#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const outputPath = resolve(
  rootDir,
  valueArg(argumentsList, "--output") ?? "dist/blame-benchmark-runner.tgz",
);

await buildPayload(outputPath);
process.stdout.write(`${outputPath}\n`);

async function buildPayload(targetPath) {
  const staging = await mkdtemp(resolve(tmpdir(), "blame-benchmark-runner-"));
  try {
    await run("pnpm", [
      "--filter",
      "@blame/benchmark-runner...",
      "run",
      "build",
    ]);
    await run("pnpm", [
      "--filter",
      "@blame/benchmark-runner",
      "deploy",
      "--prod",
      "--legacy",
      staging,
    ]);
    await prunePayload(staging);
    await writeProvenance(staging);
    await mkdir(dirname(targetPath), { recursive: true });
    await rm(targetPath, { force: true });
    await run("tar", ["-czf", targetPath, "-C", staging, "."]);
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

async function prunePayload(staging) {
  const runtimeRoot = resolve(
    staging,
    "node_modules",
    "@blame",
    "agent-runtime",
  );
  await access(resolve(runtimeRoot, "dist", "index.js"));
  const paths = [
    ".turbo",
    "eslint.config.js",
    "scripts",
    "src",
    "test-fixtures",
    "tsconfig.json",
  ];
  await Promise.all(
    paths.map((path) =>
      rm(resolve(runtimeRoot, path), { force: true, recursive: true }),
    ),
  );
}

async function writeProvenance(staging) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
  });
  const provenance = {
    commit: stdout.trim(),
    createdAt: new Date().toISOString(),
  };
  await writeFile(
    resolve(staging, "benchmark-provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
}

function run(command, args) {
  return execFileAsync(command, args, {
    cwd: rootDir,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function valueArg(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
