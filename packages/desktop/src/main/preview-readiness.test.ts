import assert from "node:assert/strict";
import test from "node:test";
import { previewContainerFailure } from "./preview-readiness.ts";

test("allows container discovery during the startup grace period", () => {
  assert.equal(
    previewContainerFailure({
      discoveryGraceMs: 15_000,
      elapsedMs: 5_000,
      found: false,
    }),
    undefined,
  );
});

test("fails missing containers after the startup grace period", () => {
  assert.equal(
    previewContainerFailure({
      discoveryGraceMs: 15_000,
      elapsedMs: 15_000,
      found: false,
    }),
    "preview_container_missing",
  );
});

test("fails terminal and unhealthy container states", () => {
  assert.equal(
    previewContainerFailure({
      discoveryGraceMs: 15_000,
      elapsedMs: 1_000,
      found: true,
      health: "unhealthy",
      status: "running",
    }),
    "preview_container_stopped",
  );
});
