import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  buildWorkspaceArtifact,
  buildWorkspaceDeltaArtifact,
} from "../packages/desktop/src/main/workspaces/workspace-artifact.ts";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "blame-preview-benchmark-"));

try {
  await exec("git", ["init", "--initial-branch=main", root]);
  for (let index = 0; index < 50; index += 1) {
    await writeFile(
      join(root, `module-${index}.ts`),
      `export const module${index} = ${JSON.stringify("x".repeat(4096))}\n`,
    );
  }
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", [
    "-C",
    root,
    "-c",
    "user.name=Blame Benchmark",
    "-c",
    "user.email=benchmark@blame.local",
    "commit",
    "-m",
    "benchmark base",
  ]);

  const cold = await timed(() => buildWorkspaceArtifact(root));
  const warm = await timed(() => buildWorkspaceArtifact(root));
  await writeFile(
    join(root, "module-0.ts"),
    "export const module0 = 'changed'\n",
  );
  await writeFile(join(root, "new-module.ts"), "export const added = true\n");
  const delta = await timed(() => buildWorkspaceDeltaArtifact(root));

  const result = {
    files: 52,
    coldFull: summary(cold),
    warmFull: summary(warm),
    delta: summary(delta),
    fullToDeltaBytes: Number(
      (cold.value.size / Math.max(1, delta.value.size)).toFixed(2),
    ),
    fullToDeltaDuration: Number(
      (cold.durationMs / Math.max(1, delta.durationMs)).toFixed(2),
    ),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function timed(operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: Math.round(performance.now() - startedAt) };
}

function summary(result) {
  return {
    durationMs: result.durationMs,
    bytes: result.value.size,
    sha256: result.value.sha256,
  };
}
