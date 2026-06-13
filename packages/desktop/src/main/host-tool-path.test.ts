import assert from "node:assert/strict";
import test from "node:test";

import { setupPath } from "./host-tool-path.ts";

test("adds Windows package manager shim paths", () => {
  const path = setupPath({
    env: {
      APPDATA: String.raw`C:\Users\dev\AppData\Roaming`,
      LOCALAPPDATA: String.raw`C:\Users\dev\AppData\Local`,
      PATH: String.raw`C:\Windows\System32`,
      ProgramFiles: String.raw`C:\Program Files`,
      USERPROFILE: String.raw`C:\Users\dev`,
    },
    execPath: String.raw`C:\Blame\Blame.exe`,
    platform: "win32",
  });
  const entries = path.split(";");

  assert.equal(
    entries.includes(String.raw`C:\Blame\resources\runtime\windows\bin`),
    true,
  );
  assert.equal(entries.includes(String.raw`C:\Users\dev\AppData\Roaming\npm`), true);
  assert.equal(entries.includes(String.raw`C:\Users\dev\AppData\Local\pnpm`), true);
  assert.equal(entries.includes(String.raw`C:\Program Files\nodejs`), true);
});

test("adds macOS packaged runtime shim path", () => {
  const path = setupPath({
    env: {
      HOME: "/Users/dev",
      PATH: "/usr/bin",
    },
    execPath: "/Applications/Blame.app/Contents/MacOS/Blame",
    platform: "darwin",
  });
  const entries = path.split(":");

  assert.equal(
    entries.includes(
      "/Applications/Blame.app/Contents/Resources/runtime/macos/bin",
    ),
    true,
  );
});
