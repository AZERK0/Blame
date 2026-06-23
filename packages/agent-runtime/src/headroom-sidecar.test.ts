import assert from "node:assert/strict";
import test from "node:test";

import { externalBaseUrl, headroomPort } from "./headroom-sidecar.js";

test("prefers Blame Headroom base URL over generic Headroom URL", () => {
  assert.equal(
    externalBaseUrl({
      BLAME_HEADROOM_BASE_URL: "http://127.0.0.1:8788",
      HEADROOM_BASE_URL: "http://127.0.0.1:8787",
    }),
    "http://127.0.0.1:8788",
  );
});

test("uses generic Headroom base URL when no Blame override exists", () => {
  assert.equal(
    externalBaseUrl({ HEADROOM_BASE_URL: "https://api.headroom.ai" }),
    "https://api.headroom.ai",
  );
});

test("resolves Headroom port from Blame override first", () => {
  assert.equal(
    headroomPort({ BLAME_HEADROOM_PORT: "8790", HEADROOM_PORT: "8787" }),
    8790,
  );
});

test("falls back to default Headroom port for invalid values", () => {
  assert.equal(headroomPort({ BLAME_HEADROOM_PORT: "nope" }), 8787);
});
