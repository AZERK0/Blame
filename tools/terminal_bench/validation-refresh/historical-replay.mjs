// Replay final workspaces/journals on independent copies. Never repair model source.
import { cp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const root = join(repo, ".blame/research/validation-refresh/historical");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const examples = ["1-date-fns-reversed-clamp-baseline", "1-lodash-inclusive-range-modified"];
const results = [];
for (const example of examples) {
  const trial = join(repo, ".blame/research/scope-followup/confirmation", example);
  const originalResult = JSON.parse(await readFile(join(trial, "result.json"), "utf8"));
  const score = JSON.parse(await readFile(join(trial, "score.json"), "utf8"));
  for (const arm of ["baseline", "modified"]) {
    const workspace = join(root, example + "-" + arm);
    await mkdir(workspace, { recursive: false });
    await cp(join(trial, "workspace"), workspace, { recursive: true,
      filter: path => !["node_modules", ".blame"].includes(path.split("/").at(-1)) });
    await symlink(join(trial, "workspace/node_modules"), join(workspace, "node_modules"));
    await cp(join(trial, "workspace/.blame/harness/light"), join(workspace, ".blame/harness/light"), { recursive: true });
    const module = join(repo, ".blame/research/validation-refresh/frozen", arm, "agent-runtime/dist/harness");
    const { LightFinishService } = await import(pathToFileURL(join(module, "light-finish-service.js")));
    const { SessionJournal } = await import(pathToFileURL(join(module, "session-journal.js")));
    const activities = [], notifications = [];
    const journal = new SessionJournal(workspace, originalResult.sessionId);
    const before = await journal.completionSnapshot();
    const service = new LightFinishService({ workspaceRoot: workspace, conversationId: originalResult.sessionId,
      onValidationActivity: activity => activities.push(activity), onComplete: value => notifications.push(value) });
    let error = null;
    try { await service.finish("Historical final-source replay", {}); } catch (caught) { error = caught.message; }
    const after = await journal.completionSnapshot();
    const hashes = {};
    for (const [path, expected] of Object.entries(score.sourceSha256)) {
      hashes[path] = sha(await readFile(join(workspace, path)));
      if (hashes[path] !== expected) throw new Error("Replay changed scored source");
    }
    const artifacts = [];
    for (const path of await readdir(join(trial, "workspace/.blame/harness/light"))) {
      const bytes = await readFile(join(trial, "workspace/.blame/harness/light", path));
      artifacts.push({ path, sha256: sha(bytes), bytes: bytes.length });
    }
    results.push({ example, arm, originalEventsSha256: sha(await readFile(join(trial, "events.jsonl"))),
      originalJournalArtifacts: artifacts, before, activities, after, notifications, error, sourceHashes: hashes,
      sourceUnchanged: before.sourceRevisionId === after.sourceRevisionId,
      limitation: "Final source copied unchanged; admission stays separate from actual refreshed tests. Unmatched shell commands remain outside F13." });
  }
}
await writeFile(join(root, "results.json"), JSON.stringify({ results }, null, 2) + "\n");
console.log(JSON.stringify(results.map(r => ({ example: r.example, arm: r.arm,
  invocations: r.activities.filter(a => a.phase === "started").map(a => a.input),
  sourceUnchanged: r.sourceUnchanged, error: r.error }))));
