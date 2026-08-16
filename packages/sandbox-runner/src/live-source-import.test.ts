import assert from "node:assert/strict";
import test from "node:test";
import { liveSourceImportAllowed } from "./workspace/source-import-policy.js";

test("allows only a complete incremental delta while services are running", () => {
  const baseHash = "a".repeat(64);
  const workspaceHash = "b".repeat(64);
  assert.equal(
    liveSourceImportAllowed({ mode: "delta", baseHash, workspaceHash }),
    true,
  );
  assert.equal(
    liveSourceImportAllowed({ mode: "full", baseHash, workspaceHash }),
    false,
  );
  assert.equal(
    liveSourceImportAllowed({ mode: "delta", workspaceHash }),
    false,
  );
  assert.equal(
    liveSourceImportAllowed({
      mode: "delta",
      baseHash,
      workspaceHash: baseHash,
    }),
    false,
  );
  assert.equal(
    liveSourceImportAllowed({
      mode: "delta",
      baseHash: "invalid",
      workspaceHash,
    }),
    false,
  );
});
