// Freeze the current production route and a research-only one-action ablation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, symlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { repo, work, studyFor } from "./campaign-paths.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT, "native2");
const study = studyFor("f27"), protocol = JSON.parse(await readFile(join(study, "protocol.json")));
const changedPath = "packages/agent-runtime/src/harness/light-edit.ts";
const patchPath = join(study, "disable-compiler-rename.patch").slice(repo.length + 1);
const patch = await readFile(join(repo, patchPath)), sha = b => createHash("sha256").update(b).digest("hex");
const archive = execFileSync("git", ["archive", protocol.baseCommit, "packages/agent-runtime"], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
await mkdir(join(work, "sources"), { recursive: true });
const bindings = [];
for (const arm of ["baseline", "modified"]) {
  const root = join(work, "sources", arm);
  if (process.argv[2] === "verify") {
    bindings.push(JSON.parse(await readFile(join(root, "source-binding.json"))));
    continue;
  }
  await mkdir(root);
  execFileSync("tar", ["-xf", "-", "-C", root], { input: archive });
  const before = await readFile(join(root, changedPath));
  if (arm === "baseline") {
    execFileSync("patch", ["-p1", "--batch", "--forward", "--dry-run"], { cwd: root, input: patch });
    execFileSync("patch", ["-p1", "--batch", "--forward"], { cwd: root, input: patch });
    assert.notEqual(sha(before), sha(await readFile(join(root, changedPath))));
  }
  const packageRoot = join(root, "packages/agent-runtime");
  await symlink(join(repo, "packages/agent-runtime/node_modules"), join(packageRoot, "node_modules"));
  await writeFile(join(packageRoot, "research-tsconfig.json"), JSON.stringify({ extends: "./tsconfig.json", exclude: ["dist", "src/**/*.test.ts"] }) + "\n");
  execFileSync(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", join(packageRoot, "research-tsconfig.json")], { cwd: repo, stdio: "inherit" });
  execFileSync(process.execPath, [join(packageRoot, "scripts/copy-prompt.mjs")], { cwd: repo, stdio: "inherit" });
  const binding = { kind: arm === "baseline" ? "single-action-ablation" : "current-production",
    baseCommit: protocol.baseCommit, archiveSha256: sha(archive),
    changedTrackedPaths: arm === "baseline" ? [changedPath] : [],
    patchFile: patchPath, patchSha256: sha(patch), appliedPatch: arm === "baseline",
    runtimeSourceSha256: sha(await readFile(join(root, changedPath))),
    productionSha256: sha(await readFile(join(packageRoot, "src/production.ts"))),
    promptSha256: sha(await readFile(join(packageRoot, "dist/prompt/code-agent-system.txt"))) };
  const bindingPath = join(root, "source-binding.json");
  await writeFile(bindingPath, JSON.stringify(binding, null, 2) + "\n"); bindings.push(binding);
  execFileSync("python", [join(repo, "tools/terminal_bench/navigation-evidence/freeze.py"), "f27", arm,
    join(packageRoot, "dist"), protocol.baseCommit, bindingPath], { cwd: repo, stdio: "inherit" });
}
const paths = (await readdir(join(work, "sources/modified/packages/agent-runtime/dist"), { recursive: true, withFileTypes: true }))
  .filter(e => e.isFile()).map(e => join(e.parentPath ?? e.path, e.name).split("/dist/")[1]).sort();
const differentFiles = [];
for (const path of paths) if (sha(await readFile(join(work, "sources/baseline/packages/agent-runtime/dist", path))) !==
  sha(await readFile(join(work, "sources/modified/packages/agent-runtime/dist", path)))) differentFiles.push(path);
assert.deepEqual(differentFiles, ["harness/light-edit.d.ts.map", "harness/light-edit.js"]);
assert.equal(bindings[0].productionSha256, bindings[1].productionSha256);
assert.equal(bindings[0].promptSha256, bindings[1].promptSha256);
await writeFile(join(study, "freeze-isolation.json"), JSON.stringify({ paidRequests: 0, bindings, differentFiles,
  assertion: "One compiled action guard plus its source/declaration maps differ; every other compiled artifact, production source and prompt are byte-identical." }, null, 2) + "\n");
console.log(JSON.stringify({ frozenArms: 2, differentFiles, paidRequests: 0 }));
