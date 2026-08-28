import assert from "node:assert/strict";
import test from "node:test";
import {
  type PreviewBrowserState,
  updatedPreviewBrowserState,
} from "./preview-browser-state.ts";

test("failed loads remain failed when loading stops", () => {
  const failed = updatedPreviewBrowserState(undefined, fallback(), {
    error: "Connection refused",
    loading: false,
  });
  const stopped = updatedPreviewBrowserState(failed, fallback(), {
    loading: false,
  });

  assert.equal(stopped.error, "Connection refused");
});

test("a new successful load clears the previous failure", () => {
  const current = { ...fallback(), error: "Connection refused" };
  const loading = updatedPreviewBrowserState(current, fallback(), {
    error: null,
    loading: true,
  });

  assert.equal(loading.error, undefined);
  assert.equal(loading.loading, true);
});

function fallback(): PreviewBrowserState {
  return {
    id: "preview-id",
    loading: false,
    url: "http://127.0.0.1:3000/",
  };
}
