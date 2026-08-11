import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewSessionView } from "./preview-session.js";
import { previewSessionLifecycle } from "./preview-lifecycle.js";

test("projects managed session axes to a stable UI lifecycle", () => {
  const session = fixture();
  session.state.host = "provisioning";
  assert.equal(previewSessionLifecycle(session).phase, "provisioning");

  session.state.host = "running";
  session.state.sync = "importing";
  assert.equal(previewSessionLifecycle(session).phase, "synchronizing");

  session.state.sync = "clean";
  session.state.engine = "preparing";
  session.state.preview = "opening";
  assert.equal(previewSessionLifecycle(session).phase, "preparing");

  session.state.engine = "running";
  session.state.preview = "ready";
  session.endpointMap = {
    revision: 1,
    primaryRouteId: "route",
    primaryPublicUrl: "https://preview.example",
    routes: [],
    supportsWebSocket: true,
    integratedPreviewRequired: false,
    incompatibilityReasons: [],
  };
  assert.deepEqual(previewSessionLifecycle(session), {
    phase: "ready",
    status: "ready",
    since: session.stateChangedAt,
  });
});

test("surfaces failures before apparently terminal host states", () => {
  const session = fixture();
  session.state.host = "destroying";
  session.failure = {
    code: "INTERNAL",
    message: "artifact cleanup failed",
    retryable: true,
  };
  assert.deepEqual(previewSessionLifecycle(session), {
    phase: "failed",
    status: "error",
    since: session.stateChangedAt,
    failure: { message: "artifact cleanup failed", retryable: true },
  });
});

test("projects desired-state commands before reconciliation starts", () => {
  const session = fixture();
  session.state.engine = "running";
  session.state.preview = "ready";
  session.desired.services = "stopped";
  session.desired.preview = "closed";
  assert.equal(previewSessionLifecycle(session).phase, "stopping");

  session.desired.host = "suspended";
  assert.equal(previewSessionLifecycle(session).phase, "suspending");

  session.desired.host = "destroyed";
  assert.equal(previewSessionLifecycle(session).phase, "destroying");

  session.desired.host = "active";
  session.state.host = "suspended";
  session.desired.services = "running";
  assert.equal(previewSessionLifecycle(session).phase, "resuming");
});

function fixture(): PreviewSessionView {
  const now = new Date().toISOString();
  return {
    id: "preview_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    userStoryId: "story",
    ownerUserId: "owner",
    profile: "vercel-compose",
    desired: {
      host: "active",
      services: "running",
      preview: "open",
      agent: "idle",
    },
    state: {
      host: "running",
      engine: "starting",
      preview: "opening",
      agent: "idle",
      sync: "clean",
    },
    revision: 1,
    generation: 1,
    planHash: "hash",
    planVersion: 1,
    resourceSize: { vcpus: 2, memoryGb: 4 },
    lastActivityAt: now,
    stateChangedAt: now,
    createdAt: now,
  };
}
