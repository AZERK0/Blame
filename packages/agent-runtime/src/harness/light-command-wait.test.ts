import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LightWorkspace } from "./light-workspace.js";

test("a six-second command returns its final outcome without status polling", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-initial-wait-"));
  try {
    const workspace = new LightWorkspace(root, { sessionId: "initial-wait" });
    const result = await workspace.runTask({
      kind: "command",
      command: "node -e 'setTimeout(() => process.stdout.write(\"complete\"), 6000)'",
    }, {});
    assert.ok(result.status === "ok", JSON.stringify(result));
    const data = result.data as { exitCode?: number; output?: string; run?: string };
    assert.equal(data.exitCode, 0);
    assert.equal(data.output, "complete");
    assert.equal(data.run, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
