import assert from "node:assert/strict";
import test from "node:test";
import { data, fixture, project, source } from "./light-agent-guidance-fixture.js";

test("empty scope explains the mistake and suggests an array without running it", async () => {
  await fixture({ "src/code.ts": source, "spec/code.ts": source }, async workspace => {
    const empty = data(await workspace.searchCode({ query: "calculate", scope: "src spec" }));
    assert.equal(empty.scopeStatus, "empty");
    assert.equal(empty.candidateCount, 0);
    assert.deepEqual(empty.results, []);
    assert.deepEqual(empty.nextSearch.scope, ["src", "spec"]);
    const recovered = data(await workspace.searchCode(empty.nextSearch));
    assert.ok(recovered.results.length > 0);
  });
});
test("literal paths with spaces remain literal scopes", async () => {
  await fixture({ "src spec/code.ts": source }, async workspace => {
    const found = data(await workspace.searchCode({ query: "calculate", scope: "src spec" }));
    assert.equal(found.candidateCount, 1);
    assert.ok(found.results.length > 0);
    assert.equal(found.nextSearch, undefined);
  });
});
test("empty globs and a missing query have different diagnoses", async () => {
  await fixture({ "code.ts": source }, async workspace => {
    const empty = data(await workspace.searchCode({ query: "calculate", scope: "absent/**/*.ts" }));
    assert.equal(empty.scopeStatus, "empty");
    assert.equal(empty.nextSearch, undefined);
    const absent = data(await workspace.searchCode({ query: "not_present", scope: "code.ts", mode: "text" }));
    assert.equal(absent.candidateCount, 1);
    assert.notEqual(absent.scopeStatus, "empty");
  });
});
test("bare reference results propose exact declaration calls without selecting a homonym", async () => {
  await fixture({ ...project, "homonym.ts": source }, async workspace => {
    const bare = data(await workspace.searchCode({ query: "calculate", mode: "references" }));
    assert.equal(bare.engine, "lexical_fallback");
    const queries = bare.nextSearches.map((input: { query: string }) => input.query);
    assert.ok(queries.includes("original.ts#calculate"));
    assert.ok(queries.includes("homonym.ts#calculate"));
    assert.match(bare.guidance, /choose|select/iu);
    const resolved = data(await workspace.searchCode(bare.nextSearches.find((input: { query: string }) => input.query === "original.ts#calculate")));
    assert.equal(resolved.engine, "typescript_language_service");
    assert.equal((await workspace.editCode({ operations: [{ kind: "symbol", target: "original.ts#calculate", action: "replace_body", content: "return 2;" }] })).status, "blocked");
  });
});
test("reference guidance is bounded and does not call a candidate unique", async () => {
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`entry${i}.ts`, source]));
  await fixture(files, async workspace => {
    const bare = data(await workspace.searchCode({ query: "calculate", mode: "references" }));
    assert.ok(bare.nextSearches.length > 0 && bare.nextSearches.length <= 4);
    assert.match(bare.guidance, /not exhaustive/iu);
    assert.equal(bare.engine, "lexical_fallback");
  });
});
test("missing bare declarations offer discovery rather than invented identity", async () => {
  await fixture({ "notes.txt": "calculate" }, async workspace => {
    const bare = data(await workspace.searchCode({ query: "calculate", mode: "references" }));
    assert.deepEqual(bare.nextSearches, [{ query: "calculate", mode: "symbol" }]);
  });
});
test("truncated raw reads provide progress and outline routes without observing unseen bodies", async () => {
  const long = "// padding\n".repeat(6500) + "export function tail() { return 7; }\n";
  await fixture({ "long.ts": long }, async workspace => {
    const read = data(await workspace.readCode({ target: "long.ts", view: "raw" }, {}));
    assert.equal(read.truncated, true);
    assert.equal(read.complete, false);
    assert.equal(Buffer.byteLength(read.content), 64000);
    assert.equal(read.nextRead.view, "range");
    assert.ok(read.nextRead.range.startLine > 1);
    assert.deepEqual(read.alternativeReads, [{ target: "long.ts", view: "outline" }]);
    assert.match(read.guidance, /not.*(?:coverage|observed)|unseen/iu);
    assert.equal((await workspace.editCode({ operations: [{ kind: "symbol", target: "long.ts#tail", action: "replace_body", content: "return 9;" }] })).status, "blocked");
    const next = data(await workspace.readCode(read.nextRead, {}));
    assert.ok(next.content.length > 0);
  });
});
test("truncation respects UTF-8 and overlapping continuation retains a partial line", async () => {
  await fixture({ "long.txt": "é".repeat(32001) + "\nend\n" }, async workspace => {
    const read = data(await workspace.readCode({ target: "long.txt", view: "raw" }, {}));
    assert.ok(!read.content.includes("�"));
    assert.equal(read.nextRead.range.startLine, 1);
    assert.equal(read.alternativeReads.length, 0);
    assert.match(data(await workspace.readCode(read.nextRead, {})).content, /end/u);
  });
});
test("complete small reads do not add recovery metadata", async () => {
  await fixture({ "small.ts": source }, async workspace => {
    const read = data(await workspace.readCode({ target: "small.ts", view: "raw" }, {}));
    assert.equal(read.complete, true);
    assert.equal(read.nextRead, undefined);
  });
});

test("empty-scope advice never broadens the search or swallows cancellation", async () => {
  await fixture({ "code.ts": source }, async workspace => {
    const absent = data(await workspace.searchCode({ query: "calculate", scope: "src absent" }));
    assert.equal(absent.scopeStatus, "empty");
    assert.equal(absent.nextSearch, undefined);
    const cancelled = await workspace.searchCode({ query: "calculate", scope: "absent" }, AbortSignal.abort(new Error("stop search")));
    assert.notEqual(cancelled.status, "ok");
  });
});

test("symbol truncation also proposes a range without granting complete declaration coverage", async () => {
  await fixture({ "long.ts": "export function calculate() {\n" + "  // body\n".repeat(6500) + "  return 7;\n}\n" }, async workspace => {
    const read = data(await workspace.readCode({ target: "long.ts#calculate" }, {}));
    assert.equal(read.truncated, true);
    assert.equal(read.fallbackReason, "symbol_exceeds_inline_budget");
    assert.equal(read.nextRead.target, "long.ts");
    assert.equal((await workspace.editCode({ operations: [{ kind: "symbol", target: "long.ts#calculate", action: "replace_body", content: "return 9;" }] })).status, "blocked");
  });
});

