// Registered grader controls and existing compiler-rename replays; zero models.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repo, work, studyFor } from "./campaign-paths.mjs";
import { applyOracle, auditMultifile } from "./multifile-criteria.mjs";
if (process.env.BLAME_STUDY_VARIANT !== "declarations") throw Error("Use the registered declarations study");
const protocol = JSON.parse(await readFile(join(studyFor("f24"), "protocol.json"), "utf8"));
if (process.argv[2] === "worker") {
  const [arm, root, taskId] = process.argv.slice(3), task = protocol.tasks.find(t => t.id === taskId);
  const { LightWorkspace } = await import(pathToFileURL(join(work, "frozen/f24", arm, "agent-runtime/dist/harness/light-workspace.js")));
  const workspace = new LightWorkspace(root, { sessionId: "local-multifile" });
  const search = await workspace.searchCode({ query: task.oldName, mode: "symbol", scope: task.declarationPath });
  const read = await workspace.readCode({ target: `${task.declarationPath}#${task.oldName}`, view: "symbol" }, {});
  const start = performance.now();
  const edit = await workspace.editCode({ operations: [{ kind: "symbol", target: `${task.declarationPath}#${task.oldName}`, action: "rename", content: task.newName }] });
  process.stdout.write(JSON.stringify({ search, readStatus: read.status, edit, renameMs: performance.now() - start }));
} else {
  const directory = join(work, "local-controls"); await mkdir(directory);
  const controls = [], replays = [];
  const original = join(repo, protocol.upstreams["date-fns"].sourceRoot);
  function prepare(root, task) {
    execFileSync(process.execPath, [join(repo, "tools/terminal_bench/navigation-evidence/run.mjs"), "prepare", "f24", root, task.id],
      { cwd: repo, stdio: "inherit" });
  }
  function check(argv, root, timeout = 120000) {
    const start = performance.now();
    const result = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: "utf8", timeout,
      env: { ...process.env, TZ: "UTC" }, maxBuffer: 8 * 1024 * 1024 });
    return { argv, code: result.status, signal: result.signal, error: result.error?.code ?? null,
      durationMs: performance.now() - start, stdout: result.stdout, stderr: result.stderr };
  }
  for (const task of protocol.tasks) {
    const root = join(directory, task.id); prepare(root, task);
    const initial = await auditMultifile(original, root, task);
    assert(initial.some(c => !c.passed), "Unchanged source must fail migration criteria");
    const sourceChecks = {};
    for (const path of task.allowedPaths) {
      const source = task.inputFiles?.[path] ?? await readFile(join(original, path), "utf8");
      const expected = applyOracle(source, task.oracle.spans[path] ?? [], task.newName);
      sourceChecks[path] = expected; await writeFile(join(root, path), expected);
    }
    const positive = await auditMultifile(original, root, task); assert(positive.every(c => c.passed));
    const fixture = Object.keys(task.inputFiles)[0];
    await writeFile(join(root, fixture), sourceChecks[fixture].replaceAll(task.oldName, task.newName));
    const lexical = await auditMultifile(original, root, task); assert(lexical.some(c => !c.passed));
    await writeFile(join(root, fixture), sourceChecks[fixture]);
    const consumer = Object.keys(task.oracle.spans).find(p => p !== task.declarationPath && p !== fixture);
    await writeFile(join(root, consumer), await readFile(join(original, consumer)));
    const partial = await auditMultifile(original, root, task); assert(partial.some(c => !c.passed));
    await writeFile(join(root, consumer), sourceChecks[consumer]);
    const types = check(["npm", "run", "types"], root);
    const selected = check(["npm", "test", "--", "--maxWorkers=1", "--minWorkers=1", "--pool=forks", ...task.selectedTests], root);
    const full = check(["npm", "test", "--", "--maxWorkers=1", "--minWorkers=1", "--pool=forks"], root);
    controls.push({ id: task.id, originalRejected: true, oracleAccepted: true, lexicalHomonymRejected: true,
      missingConsumerRejected: true, positiveChecks: positive, types, selected, full });
    await writeFile(join(directory, "controls.json"), JSON.stringify(controls, null, 2) + "\n");
    for (const arm of ["baseline", "modified"]) {
      const replayRoot = join(directory, `${task.id}-${arm}`); prepare(replayRoot, task);
      const invocation = check([process.execPath, new URL(import.meta.url).pathname, "worker", arm, replayRoot, task.id], repo, 90000);
      let response; try { response = JSON.parse(invocation.stdout); } catch {}
      const criteria = await auditMultifile(original, replayRoot, task);
      const sourceMatchesValidatedControl = (await Promise.all(task.allowedPaths.map(async path =>
        (await readFile(join(replayRoot, path), "utf8")) === sourceChecks[path]))).every(Boolean);
      const changedPaths = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: replayRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean);
      const unexpectedPaths = changedPaths.filter(path => !task.allowedPaths.includes(path));
      replays.push({ id: task.id, arm, invocation, response, criteria,
        sourceMatchesValidatedControl, changedPaths, unexpectedPaths,
        auditedMigration: invocation.code === 0 && response?.edit?.status === "ok" && criteria.every(c => c.passed) && unexpectedPaths.length === 0 });
      await writeFile(join(directory, "semantic-replays.json"), JSON.stringify(replays, null, 2) + "\n");
    }
  }
  await writeFile(join(studyFor("f24"), "local-controls.json"), JSON.stringify({ paidRequests: 0, controls, replays }, null, 2) + "\n");
  console.log(JSON.stringify({ controls: controls.length * 4, semanticReplays: replays.length,
    auditedMigrations: replays.filter(r => r.auditedMigration).length, paidRequests: 0 }));
}
