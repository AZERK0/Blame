import assert from "node:assert/strict";
import test from "node:test";

import {
  hyprlandLegacyDispatchers,
  hyprlandLuaDispatchers,
  hyprlandWindowAddress,
} from "./hyprland-window.ts";
import { mainWindowPresentation } from "./main-window-presentation.ts";

const compactInput = {
  presentation: mainWindowPresentation("Blame", "compact"),
  role: "compact" as const,
};

test("finds a Hyprland client by process and initial title", () => {
  const clients = JSON.stringify([
    { address: "0x111", initialTitle: "Blame", pid: 42 },
    { address: "0x222", initialTitle: "Blame - Compact", pid: 42 },
  ]);

  assert.equal(hyprlandWindowAddress(clients, 42, "Blame - Compact"), "0x222");
  assert.equal(hyprlandWindowAddress(clients, 7, "Blame - Compact"), undefined);
  assert.equal(hyprlandWindowAddress("invalid", 42, "Blame"), undefined);
});

test("builds idempotent Lua dispatchers for compact windows", () => {
  assert.deepEqual(hyprlandLuaDispatchers(compactInput, "0x222"), [
    [
      "dispatch",
      'hl.dsp.window.float({ action = "enable", window = "address:0x222" })',
    ],
    [
      "dispatch",
      'hl.dsp.window.resize({ x = 900, y = 700, window = "address:0x222" })',
    ],
    ["dispatch", 'hl.dsp.window.center({ window = "address:0x222" })'],
  ]);
});

test("builds an idempotent Lua dispatcher for workspace windows", () => {
  const workspaceInput = {
    presentation: mainWindowPresentation("Blame", "workspace"),
    role: "workspace" as const,
  };

  assert.deepEqual(hyprlandLuaDispatchers(workspaceInput, "0x222"), [
    [
      "dispatch",
      'hl.dsp.window.float({ action = "disable", window = "address:0x222" })',
    ],
  ]);
});

test("builds legacy fallback dispatchers without changing focus", () => {
  assert.deepEqual(hyprlandLegacyDispatchers(compactInput, "0x222"), [
    ["dispatch", "setfloating", "address:0x222"],
    ["dispatch", "resizewindowpixel", "exact 900 700,address:0x222"],
  ]);
});
