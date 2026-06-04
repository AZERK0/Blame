import assert from "node:assert/strict";
import test from "node:test";
import { resolveSetupBash, setupShellCommand } from "./setup-shell.ts";

test("uses bash on Unix platforms", () => {
  assert.equal(resolveSetupBash({ platform: "linux" }), "bash");
});

test("uses configured bash path on Windows", () => {
  const command = resolveSetupBash({
    env: { BLAME_BASH_PATH: String.raw`C:\Tools\Git\bin\bash.exe` },
    pathExists: (path) => path === String.raw`C:\Tools\Git\bin\bash.exe`,
    platform: "win32",
  });

  assert.equal(command, String.raw`C:\Tools\Git\bin\bash.exe`);
});

test("prefers Git Bash install paths on Windows", () => {
  const command = resolveSetupBash({
    env: { ProgramFiles: String.raw`C:\Program Files` },
    pathExists: (path) => path === String.raw`C:\Program Files\Git\bin\bash.exe`,
    platform: "win32",
  });

  assert.equal(command, String.raw`C:\Program Files\Git\bin\bash.exe`);
});

test("builds setup shell command arguments", () => {
  const command = setupShellCommand("/tmp/setup.sh", { platform: "linux" });

  assert.deepEqual(command, {
    args: ["/tmp/setup.sh"],
    command: "bash",
  });
});

test("normalizes Windows setup script argument for Bash", () => {
  const command = setupShellCommand(String.raw`C:\Project\.blame\setup.sh`, {
    env: { ProgramFiles: String.raw`C:\Program Files` },
    pathExists: (path) => path === String.raw`C:\Program Files\Git\bin\bash.exe`,
    platform: "win32",
  });

  assert.deepEqual(command, {
    args: ["C:/Project/.blame/setup.sh"],
    command: String.raw`C:\Program Files\Git\bin\bash.exe`,
  });
});
