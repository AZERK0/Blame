import assert from "node:assert/strict";
import test from "node:test";

import { desktopAppIdentity } from "./desktop-app-identity.ts";

test("uses the release identity for packaged applications", () => {
  assert.deepEqual(desktopAppIdentity(true), {
    appId: "dev.blame.desktop",
    name: "Blame",
  });
});

test("uses a separate identity for local development", () => {
  assert.deepEqual(desktopAppIdentity(false), {
    appId: "dev.blame.desktop.development",
    name: "Blame Dev",
  });
});
