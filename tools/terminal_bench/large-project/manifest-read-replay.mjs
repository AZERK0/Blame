// Replay existing navigation on the unchanged real manifest; bytes are not billed tokens.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2]);
const { LightWorkspace } = await import(pathToFileURL(resolve("packages/agent-runtime/dist/harness/light-workspace.js")));
const workspace = new LightWorkspace(root, { sessionId: "manifest-reading-local" });
const before = await readFile(join(root, "package.json"));
const raw = await workspace.readCode({ target: "package.json", view: "raw" }, {});
const search = await workspace.searchCode({ query: '"scripts"', scope: "package.json", mode: "text" });
assert.equal(search.status, "ok");
const lines = before.toString().split("\n");
const startLine = lines.findIndex(line => /^\s*"scripts":/u.test(line)) + 1;
assert.ok(startLine > 0);
// The caller derives this line from the actual lexical result; assert it is exposed.
assert.ok(JSON.stringify(search).includes(String(startLine)));
let endLine = startLine;
while (!/^\s*\},?\s*$/u.test(lines[endLine - 1])) {
  assert.ok(endLine < lines.length);
  endLine++;
}
const range = await workspace.readCode({ target: "package.json", range: { startLine, endLine } }, {});
assert.equal(range.status, "ok");
assert.equal(raw.data.complete, false);
assert.ok(!raw.data.content.includes('"scripts"'));
const parsed = JSON.parse(before);
for (const [name, command] of Object.entries(parsed.scripts))
  assert.ok(range.data.content.includes(JSON.stringify(name) + ": " + JSON.stringify(command)));
assert.deepEqual(await readFile(join(root, "package.json")), before);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const rawBytes = bytes(raw), targetedBytes = bytes(search) + bytes(range);
assert.ok(targetedBytes < rawBytes);
process.stdout.write(JSON.stringify({ sourceSha256: createHash("sha256").update(before).digest("hex"),
  sourceBytes: before.length, scripts: Object.keys(parsed.scripts), sourceUnchanged: true,
  raw: { bytes: rawBytes, complete: raw.data.complete, scriptsIncluded: false },
  targeted: { bytes: targetedBytes, startLine, endLine, scriptsIncluded: true, search, range },
  returnedByteRatio: targetedBytes / rawBytes,
  limitation: "Direct navigation replay, no model completion, billed token, cost, cache or time gain inferred." }, null, 2) + "\n");
