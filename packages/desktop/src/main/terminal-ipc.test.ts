import assert from "node:assert/strict";
import test from "node:test";
import { terminalShell } from "./terminal-shell.ts";

test("uses runtime bash for runtime-managed Windows worktrees", () => {
  assert.deepEqual(
    terminalShell(
      "/home/blame/.local/share/blame/runtime/worktrees/Blame/story-1-test",
      "win32",
    ),
    {
      args: ["-l"],
      command: "bash",
      runtime: true,
    },
  );
});

test("uses native terminal shell outside runtime worktrees", () => {
  assert.equal(terminalShell("/tmp/project", "linux").runtime, false);
});
