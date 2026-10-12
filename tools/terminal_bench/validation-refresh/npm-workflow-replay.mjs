// Counterfactual workflow on independent unchanged final production source.
// Reproduce the observed raw npm -> test-description edit -> types -> finish order.
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const root = join(repo, ".blame/research/validation-refresh/npm-workflow");
const trial = join(repo, ".blame/research/scope-followup/confirmation/1-date-fns-reversed-clamp-baseline");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const score = JSON.parse(await readFile(join(trial, "score.json"), "utf8"));
const journalFiles = await import("node:fs/promises").then(fs => fs.readdir(join(trial, "workspace/.blame/harness/light")));
const originalJournal = await readFile(join(trial, "workspace/.blame/harness/light", journalFiles[0]), "utf8");
const command = originalJournal.split("\n").filter(Boolean).map(JSON.parse)
  .find(event => event.type === "validation" && event.command?.startsWith("npm test -- ")).command;
const results = [];
for (const arm of ["baseline", "modified"]) {
  const workspace = join(root, arm);
  await mkdir(workspace, { recursive: false });
  await cp(join(trial, "workspace"), workspace, { recursive: true,
    filter: path => !["node_modules", ".blame"].includes(path.split("/").at(-1)) });
  await symlink(join(trial, "workspace/node_modules"), join(workspace, "node_modules"));
  const path = "src/clamp/reversed/test.ts";
  const finalContent = await readFile(join(workspace, path), "utf8");
  const marker = "// Counterfactual replay-only earlier test-description marker.";
  await writeFile(join(workspace, path), finalContent + "\n" + marker + "\n");
  const module = join(repo, ".blame/research/validation-refresh/frozen", arm, "agent-runtime/dist/harness");
  const { LightWorkspace } = await import(pathToFileURL(join(module, "light-workspace.js")));
  const { LightFinishService } = await import(pathToFileURL(join(module, "light-finish-service.js")));
  const { SessionJournal } = await import(pathToFileURL(join(module, "session-journal.js")));
  const tools = new LightWorkspace(workspace, { sessionId: "npm-counterfactual" });
  const observed = await tools.runTask({ kind: "command", command }, {});
  const edit = await tools.editCode({ operations: [{ kind: "patch", path,
    patch: `*** Begin Patch\n*** Update File: ${path}\n@@\n-\n-${marker}\n*** End Patch` }] });
  if (edit.status !== "ok") throw new Error(JSON.stringify(edit));
  await tools.runTask({ kind: "command", command: "npm run types" }, {});
  const activities = [], notifications = [];
  const service = new LightFinishService({ conversationId: "npm-counterfactual", workspaceRoot: workspace,
    onValidationActivity: a => activities.push(a), onComplete: n => notifications.push(n) });
  await service.finish("Replay complete", {});
  const final = await new SessionJournal(workspace, "npm-counterfactual").completionSnapshot();
  const hashes = {};
  for (const [path, expected] of Object.entries(score.sourceSha256)) {
    hashes[path] = sha(await readFile(join(workspace, path)));
    if (hashes[path] !== expected) throw new Error("Final scored source differs; no source repair allowed.");
  }
  results.push({ arm, command, initialObservation: observed, activities, notifications, final, sourceHashes: hashes,
    originalJournalSha256: sha(originalJournal), originalEventsSha256: sha(await readFile(join(trial, "events.jsonl"))),
    limitation: "Counterfactual new invocation with a replay-only comment then removal. Final source exactly matches the unchanged historical score. Never reinterpret or modify original model traces/journals." });
}
await writeFile(join(root, "results.json"), JSON.stringify({ results }, null, 2) + "\n");
console.log(JSON.stringify(results.map(r => ({ arm: r.arm,
  invocations: r.activities.filter(a => a.phase === "started").map(a => a.input),
  finalTests: r.final.validations.filter(v => v.taskKind === "test").map(v => ({ args: v.args, status: v.status, check: v.check })) }))));
