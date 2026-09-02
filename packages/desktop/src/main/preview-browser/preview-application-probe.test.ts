import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPreviewApplication,
  probePreviewApplication,
} from "./preview-application-probe.ts";

test("classifies healthy and compiler-error preview responses", () => {
  assert.deepEqual(
    classifyPreviewApplication({ httpStatus: 200, text: "<main>Ready</main>" }),
    { status: "ready", httpStatus: 200 },
  );
  assert.deepEqual(
    classifyPreviewApplication({
      httpStatus: 200,
      text: "Failed to compile: Module not found: prisma",
    }),
    {
      status: "failed",
      httpStatus: 200,
      diagnostic: "Failed to compile: Module not found: prisma",
    },
  );
});

test("bounds an unresponsive renderer probe", async () => {
  const state = await probePreviewApplication(
    () => new Promise(() => undefined),
    5,
  );

  assert.equal(state.status, "failed");
  assert.equal(state.diagnostic, "Preview application probe timed out.");
});
