import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./corpus-utils.mjs";

export async function recordCampaignProvenance(directory, scenarios) {
  const roots = [
    "packages/agent-runtime",
    "packages/harness-core",
    "packages/benchmark-runner",
    "tools/terminal_bench/corpus",
  ];
  const patch = git(["diff", "HEAD", "--", ...roots]);
  const untracked = git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...roots,
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
  const newFiles = Object.fromEntries(
    await Promise.all(
      untracked.map(async (path) => [
        path,
        await readFile(join(repositoryRoot, path), "utf8"),
      ]),
    ),
  );
  await writeFile(join(directory, "harness.patch"), patch);
  await writeFile(
    join(directory, "harness-new-files.json"),
    JSON.stringify(newFiles, null, 2),
  );
  const provenance = {
    baseCommit: git(["rev-parse", "HEAD"]).trim(),
    sourcePatchSha256: digest(patch + JSON.stringify(newFiles)),
    runtimeSha256: await runtimeDigest(),
    scenarios: scenarios.map(({ id }) => id),
    capturedAt: new Date().toISOString(),
  };
  await writeFile(
    join(directory, "provenance.json"),
    JSON.stringify(provenance, null, 2),
  );
}

async function runtimeDigest() {
  const hash = createHash("sha256");
  for (const directory of [
    "packages/agent-runtime/dist",
    "packages/harness-core/dist",
    "packages/benchmark-runner/dist",
  ]) {
    const paths = (
      await readdir(join(repositoryRoot, directory), { recursive: true })
    )
      .filter((path) => path.endsWith(".js"))
      .sort();
    for (const path of paths) {
      hash.update(`${directory}/${path}\0`);
      hash.update(await readFile(join(repositoryRoot, directory, path)));
    }
  }
  return hash.digest("hex");
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
