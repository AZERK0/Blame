// Local mechanism checks on the same pinned source; never run during timed model trials.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { LightWorkspace } from "../../../packages/agent-runtime/dist/harness/light-workspace.js";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const work = join(repo, ".blame/research/semantic-rename");
const upstream = join(work, "date-fns");
const study = join(repo, "docs/experiments/light-harness-semantic-rename-2026-10-12");
const protocol = JSON.parse(await readFile(join(study, "protocol.json"), "utf8"));
const observations = [];
for (const task of protocol.tasks.slice(0, 2)) {
  const root = join(work, process.argv[2] ?? "local", task.id);
  await mkdir(join(work, process.argv[2] ?? "local"), { recursive: true });
  execFileSync("git", ["clone", "--shared", "--no-hardlinks", upstream, root], { stdio: "ignore" });
  await symlink(join(upstream, "node_modules"), join(root, "node_modules"));
  const workspace = new LightWorkspace(root, { sessionId: "local-rename" });
  const target = task.target + "#" + task.oldName;
  assert.equal((await workspace.readCode({ target, view: "symbol" }, {})).status, "ok");
  const started = performance.now();
  const result = await workspace.editCode({ operations: [
    { kind: "symbol", target, action: "rename", content: task.newName },
  ] });
  const durationMs = performance.now() - started;
  const checks = [];
  for (const argv of [[process.execPath, join(repo, "tools/terminal_bench/semantic-rename/feature-checks.mjs"), root, task.id],
    ["npm", "run", "types"], ["npm", "test", "--", "--maxWorkers=1", "--minWorkers=1", "--pool=forks",
      ...protocol.tasks[0].instruction.match(/src\/[^\s]+test\.ts/gu)]]) {
    const executed = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "utf8", timeout: 120000,
      env: { ...process.env, TZ: "UTC" } });
    checks.push({ argv, exitCode: executed.status, error: executed.error?.code ?? null,
      stdout: executed.stdout, stderr: executed.stderr });
  }
  const diff = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, encoding: "utf8" });
  observations.push({ task: task.id, result, durationMs, checks, diff });
  await writeFile(join(study, "local-replay.json"), JSON.stringify({ compiler: "5.9.3", upstream: protocol.upstreamCommit,
    interpretation: "Cold disposable compiler worker included; single local observations on warm filesystem, not controlled model efficiency. Static guards do not substitute for these actual checks.", observations }, null, 2) + "\n");
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.ok(checks.every(check => check.exitCode === 0), task.id);
}
