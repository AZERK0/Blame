import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewLifecycleState } from "@blame/preview-contract";
import type { PreviewDevtoolsTarget } from "../preview-browser/preview-browser-manager.ts";
import {
  previewHarnessState,
  resolvePreviewHarnessState,
} from "./preview-harness-state.ts";

test("stopped previews return immediately even when ready was requested", async () => {
  let refreshes = 0;

  const state = await resolvePreviewHarnessState(
    async () => previewHarnessState(browserTarget(), idleLifecycle()),
    "ready",
    async () => {
      refreshes += 1;
    },
  );

  assert.equal(state.status, "stopped");
  assert.equal(state.available, false);
  assert.equal(refreshes, 0);
});

test("failed previews return immediately with their failure", async () => {
  const state = previewHarnessState(browserTarget(), {
    failure: { message: "Web container exited" },
    phase: "failed",
    since: new Date().toISOString(),
    status: "error",
  });

  assert.equal(state.status, "failed");
  assert.equal(state.reason, "PREVIEW_FAILED");
  assert.equal(state.message, "Web container exited");
});

test("ready waits only while the preview is actively starting", async () => {
  let browserInspections = 0;
  let lifecycleInspections = 0;

  const state = await resolvePreviewHarnessState(
    async () =>
      previewHarnessState(
        browserTarget(++browserInspections > 1),
        ++lifecycleInspections > 1 ? readyLifecycle() : startingLifecycle(),
      ),
    "ready",
    async () => undefined,
  );

  assert.equal(state.status, "ready");
  assert.equal(state.available, true);
});

test("none returns the current starting state without refreshing", async () => {
  let refreshes = 0;

  const state = await resolvePreviewHarnessState(
    async () =>
      previewHarnessState(browserTarget(false, true), startingLifecycle()),
    "none",
    async () => {
      refreshes += 1;
    },
  );

  assert.equal(state.status, "starting");
  assert.equal(refreshes, 0);
});

test("ready runtime without a browser view is immediately unavailable", async () => {
  let refreshes = 0;

  const state = await resolvePreviewHarnessState(
    async () => previewHarnessState(browserTarget(), readyLifecycle()),
    "ready",
    async () => {
      refreshes += 1;
    },
  );

  assert.equal(state.status, "unavailable");
  assert.equal(state.reason, "PREVIEW_BROWSER_NOT_OPEN");
  assert.equal(refreshes, 0);
});

test("stopping is non-waitable", () => {
  const state = previewHarnessState(browserTarget(true), {
    phase: "stopping",
    since: new Date().toISOString(),
    status: "pending",
  });

  assert.equal(state.status, "stopped");
  assert.equal(state.available, false);
});

function browserTarget(available = false, loading = false) {
  return {
    available,
    browserUrl: "http://127.0.0.1:9222",
    ...(available || loading ? { currentUrl: "http://127.0.0.1:3000/" } : {}),
    loading,
    mcpServer: { args: [], command: "node", name: "chrome-devtools" },
  } satisfies PreviewDevtoolsTarget;
}

function idleLifecycle(): PreviewLifecycleState {
  return { phase: "idle", since: new Date().toISOString(), status: "idle" };
}

function startingLifecycle(): PreviewLifecycleState {
  return {
    phase: "starting",
    since: new Date().toISOString(),
    status: "pending",
  };
}

function readyLifecycle(): PreviewLifecycleState {
  return { phase: "ready", since: new Date().toISOString(), status: "ready" };
}
