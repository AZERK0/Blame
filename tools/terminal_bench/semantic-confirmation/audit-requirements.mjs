// Post-selected grammar audit. Preserve every registered score and raw source.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compilerVersion, onlyIdentifierRename } from "../corpus/identifier-token-audit.mjs";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const study = join(repo, "docs/experiments/light-harness-semantic-confirmation-2026-10-12");
const campaign = join(repo, ".blame/research/semantic-confirmation/pilot");
const original = join(repo, ".blame/research/semantic-confirmation/date-fns");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const protocol = await json(join(study, "protocol.json"));
const specification = await json(join(study, "post-selected-audit-protocol.json"));
for (const [path, hash] of Object.entries(specification.codeSha256))
  assert.equal(sha(await readFile(join(repo, path))), hash);
const analysis = await json(join(campaign, "analysis.json"));
const checks = [];
for (const row of analysis.rows) {
  const task = protocol.tasks.find(task => task.id === row.id);
  const directory = join(campaign, row.name), workspace = join(directory, "workspace");
  const score = await json(join(directory, "score.json"));
  const sources = [];
  for (const [path, hash] of Object.entries(task.selectedSourceSha256)) {
    const before = await readFile(join(original, path), "utf8");
    const after = await readFile(join(workspace, path), "utf8");
    assert.equal(sha(before), hash);
    assert.equal(sha(after), score.sourceSha256[path]);
    sources.push({ path, sourceSha256: sha(after), passed: onlyIdentifierRename(before, after, task.oldName, task.newName) });
  }
  // The earlier scorer accidentally used its old seven-file list. Execute the
  // newly requested selection separately; never overwrite that original score.
  const selected = [...task.instruction.matchAll(/src\/[^\s]+test\.ts/gu)].map(match => match[0]);
  assert.equal(selected.length, 7);
  const argv = ["npm", "test", "--", "--maxWorkers=1", "--minWorkers=1", "--pool=forks", ...selected];
  const start = performance.now();
  const execution = spawnSync(argv[0], argv.slice(1), { cwd: workspace, encoding: "utf8", timeout: 120000,
    env: { ...process.env, TZ: "UTC" } });
  const requiredSelected = { argv, exitCode: execution.status, error: execution.error?.code ?? null,
    durationMs: performance.now() - start, stdout: execution.stdout, stderr: execution.stderr };
  checks.push({ name: row.name, id: row.id, arm: row.arm, originalRegisteredFunctionalSuccess: row.independentFunctionalSuccess,
    eventsSha256: row.eventsSha256, diffSha256: row.diffSha256, scoreSha256: row.scoreSha256,
    sources, requiredSelected,
    postSelectedRequirementSuccess: sources.every(source => source.passed) && requiredSelected.exitCode === 0 &&
      score.types.exitCode === 0 && score.full.exitCode === 0 && score.unexpectedPaths.length === 0 });
}
await writeFile(join(study, "requirement-audit.json"), JSON.stringify({
  method: "Post-selected parser-context Identifier-only/nontrivia audit and independently executed requested selection. Original registered oracle, selected-list error, scores and source remain unchanged. Manual trace/criteria/no-retrieval decisions are additionally required; this is not the primary endpoint.",
  compilerVersion, auditCodeSha256: specification.codeSha256,
  protocolSha256: sha(await readFile(join(study, "protocol.json"))),
  specificationSha256: sha(await readFile(join(study, "post-selected-audit-protocol.json"))),
  planned: analysis.planned, completed: analysis.completed, checks,
}, null, 2) + "\n");
console.log(JSON.stringify({ completed: checks.length, postSelectedRequirementSuccess: checks.filter(check => check.postSelectedRequirementSuccess).length }));
