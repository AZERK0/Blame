import assert from "node:assert/strict";
import test from "node:test";
import type { ContentBlock, Message, ToolResultContent } from "@cline/sdk";
import { presentToolResults } from "./tool-result-presentation.js";

test("source text reaches the provider with original quotes, slashes, and Unicode", () => {
  const source = 'pattern = r"\\d+\\.é"\npath = "C:\\\\tools"\r\n';
  const result = { status: "ok", data: { path: "source.py", content: source, lines: [1, 2], complete: true, editTargets: [{ alias: "s1" }] } };
  const history = messages("read_code", result);
  const original = structuredClone(history);
  const projected = presentToolResults(history);
  const output = content(projected);
  assert.ok(output.includes(source));
  assert.equal(output.includes(JSON.stringify(source)), false);
  assert.deepEqual(JSON.parse(output.split("\n")[0]!), { status: "ok", data: { path: "source.py", lines: [1, 2], complete: true, editTargets: [{ alias: "s1" }] } });
  assert.deepEqual(history, original);
  assert.deepEqual(presentToolResults(projected), projected);
});

test("command failures retain their status and display exact diagnostics", () => {
  const message = "Patch context does not match.\nExpected: r'\\d+'\n";
  const history = messages("edit_code", { status: "blocked", category: "input", message, recovery: "Read the current target.", diagnosticId: "edit-1" });
  const projected = content(presentToolResults(history));
  assert.ok(projected.includes(message));
  assert.deepEqual(JSON.parse(projected.split("\n")[0]!), { status: "blocked", category: "input", recovery: "Read the current target.", diagnosticId: "edit-1" });
});

test("multisegment reads retain their boundaries and metadata", () => {
  const data = { path: "component.ts", segments: [{ lines: [1, 2], content: "import x;\n" }, { lines: [8, 9], content: "return x;\n" }] };
  const output = content(presentToolResults(messages("read_code", { status: "ok", data })));
  assert.ok(output.includes("data.segments[0].content:\n```\nimport x;\n"));
  assert.ok(output.includes("data.segments[1].content:\n```\nreturn x;\n"));
  assert.deepEqual(JSON.parse(output.split("\n")[0]!).data.segments, [{ lines: [1, 2] }, { lines: [8, 9] }]);
});

test("source containing Markdown fences remains within a longer fence", () => {
  const source = '```js\nconst text = "````";\n```';
  const output = content(presentToolResults(messages("read_code", { status: "ok", data: { content: source } })));
  assert.ok(output.endsWith(`data.content:\n\`\`\`\`\`\n${source}\n\`\`\`\`\``));
});

test("native tools, malformed results, simple text, and images remain unchanged", () => {
  const image = messages("read_code", { status: "ok" });
  const block = (image[1]!.content as ToolResultContent[])[0]!;
  block.content = [{ type: "text", text: "image metadata" }, { type: "image", mediaType: "image/png", data: "aW1hZ2U=" }];
  for (const history of [messages("read_file", { status: "ok", data: { content: "line\n" } }), messages("read_code", "not JSON"), messages("read_code", { status: "ok", data: { content: "plain" } }), image])
    assert.deepEqual(presentToolResults(history), history);
});

function messages(name: string, result: unknown): Message[] {
  return [
    { role: "assistant", content: [{ type: "tool_use", id: "call", name, input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call", content: typeof result === "string" ? result : JSON.stringify(result) }] },
  ];
}

function content(messages: Message[]) {
  const block = (messages[1]!.content as ContentBlock[])[0]!;
  assert.equal(block.type, "tool_result");
  return (block as ToolResultContent).content as string;
}
