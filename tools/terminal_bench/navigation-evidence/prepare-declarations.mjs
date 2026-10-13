// Rebuild both arms from registered immutable source; never overwrite a freeze.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { repo, work, studyFor } from "./campaign-paths.mjs";
if (!["declarations", "declarations-eur1"].includes(process.env.BLAME_STUDY_VARIANT))
  throw Error("Use a registered declarations study variant");
const protocol = JSON.parse(await readFile(join(studyFor("f24"), "protocol.json"), "utf8"));
const patchPath = "docs/experiments/light-harness-declaration-navigation-local-2026-10-13/candidate.patch";
const patch = await readFile(join(repo, patchPath)), sha = value => createHash("sha256").update(value).digest("hex");
const archive = execFileSync("git", ["archive", protocol.baseCommit, "packages/agent-runtime"], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
for (const arm of ["baseline", "modified"]) {
  const root = join(work, "sources", arm);
  await mkdir(root, { recursive: false }).catch(async error => {
    if (error.code !== "ENOENT") throw error;
    await mkdir(join(work, "sources"), { recursive: true }); await mkdir(root);
  });
  execFileSync("tar", ["-xf", "-", "-C", root], { input: archive });
  const changedPath = "packages/agent-runtime/src/harness/light-workspace.ts";
  const before = await readFile(join(root, changedPath));
  if (arm === "modified") {
    // git apply inside a nested ignored directory can silently skip every hunk.
    execFileSync("patch", ["-p1", "--batch", "--forward", "--dry-run"], { cwd: root, input: patch });
    execFileSync("patch", ["-p1", "--batch", "--forward"], { cwd: root, input: patch });
    if (sha(before) === sha(await readFile(join(root, changedPath)))) throw Error("Candidate patch was not applied");
  }
  const packageRoot = join(root, "packages/agent-runtime");
  await symlink(join(repo, "packages/agent-runtime/node_modules"), join(packageRoot, "node_modules"));
  await writeFile(join(packageRoot, "research-tsconfig.json"), JSON.stringify({ extends: "./tsconfig.json", exclude: ["dist", "src/**/*.test.ts"] }) + "\n");
  execFileSync(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", join(packageRoot, "research-tsconfig.json")], { cwd: repo, stdio: "inherit" });
  execFileSync(process.execPath, [join(packageRoot, "scripts/copy-prompt.mjs")], { cwd: repo, stdio: "inherit" });
  const binding = { kind: arm === "baseline" ? "frozen-baseline" : "single-mechanism-candidate",
    baseCommit: protocol.baseCommit, archiveSha256: sha(archive),
    changedTrackedPaths: arm === "baseline" ? [] : ["packages/agent-runtime/src/harness/light-workspace.ts"],
    patchFile: patchPath, patchSha256: sha(patch), appliedPatch: arm === "modified",
    runtimeSourceSha256: sha(await readFile(join(root, changedPath))),
    productionSha256: sha(await readFile(join(packageRoot, "src/production.ts"))),
    promptSha256: sha(await readFile(join(packageRoot, "dist/prompt/code-agent-system.txt"))) };
  // Prompt location is bound by the complete frozen tree even when layouts vary.
  const bindingPath = join(root, "source-binding.json");
  await writeFile(bindingPath, JSON.stringify(binding, null, 2) + "\n");
  execFileSync("python", [join(repo, "tools/terminal_bench/navigation-evidence/freeze.py"), "f24", arm,
    join(packageRoot, "dist"), protocol.baseCommit, bindingPath], { cwd: repo, stdio: "inherit" });
}
console.log(JSON.stringify({ frozenArms: 2, paidRequests: 0 }));
