import assert from "node:assert/strict";
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentToolContext, ToolResultContent } from "@cline/sdk";
import { projectProviderContext } from "../context-projection.js";
import { executeLightWorkspaceRequest } from "./light-executor.js";
import { lightSemanticHarnessTools } from "./light-tools.js";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=", "base64");
const context: AgentToolContext = { agentId: "image-reader", iteration: 1, metadata: { modelSupportsImages: true } };

for (const executor of [undefined, executeLightWorkspaceRequest]) {
  test(`image reads reach the provider as media through ${executor ? "the bridge" : "local execution"}`, async () => {
    await fixture(async (root) => {
      const tool = lightSemanticHarnessTools(root, { executor }).find((tool) => tool.name === "read_code")!;
      const output = await tool.execute({ target: "pixel.png" }, context);
      assert.ok(Array.isArray(output));
      assert.deepEqual(output[1], { type: "image", mediaType: "image/png", data: pixel.toString("base64") });
      assert.doesNotMatch(output[0].text, /base64|�/);
      const content: ToolResultContent = { type: "tool_result", tool_use_id: "image-1", name: "read_code", content: output };
      const result = projectProviderContext([{ role: "user", content: [content] }], { systemPrompt: "", tools: [] });
      assert.deepEqual(result.messages[0]?.content, [content]);
    });
  });
}

test("image reads fail clearly when the model has no image capability", async () => {
  await fixture(async (root) => {
    for (const metadata of [undefined, { modelSupportsImages: false }]) {
      const result = await read(root, "pixel.png", { ...context, metadata });
      assert.equal(result.status, "blocked");
      assert.match(String(result.message), /does not support image input/);
      assert.equal(result.content, undefined);
    }
  });
});

test("mislabeled and oversized images never become provider image blocks", async () => {
  await fixture(async (root) => {
    await writeFile(join(root, "invalid.png"), "this is text");
    assert.equal((await read(root, "invalid.png")).status, "blocked");
    const file = await open(join(root, "pixel.png"), "r+");
    try { await file.truncate(10_000_001); } finally { await file.close(); }
    const result = await read(root, "pixel.png");
    assert.equal(result.status, "blocked");
    assert.match(String(result.message), /exceeds 10 MB/);
  });
});

test("image reads retain workspace and symlink boundaries", async () => {
  await fixture(async (root) => {
    assert.equal((await read(root, "../outside.png")).status, "blocked");
    if (process.platform !== "win32") {
      await symlink(join(root, "pixel.png"), join(root, "linked.png"));
      assert.equal((await read(root, "linked.png")).status, "blocked");
    }
  });
});

async function read(root: string, target: string, inputContext = context) {
  const tool = lightSemanticHarnessTools(root).find((tool) => tool.name === "read_code")!;
  return await tool.execute({ target }, inputContext) as Record<string, unknown>;
}

async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-image-read-"));
  try {
    await writeFile(join(root, "pixel.png"), pixel);
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
