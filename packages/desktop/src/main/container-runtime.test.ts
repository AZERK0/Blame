import assert from "node:assert/strict";
import test from "node:test";
import {
  containerRuntimeEnvironment,
  parseInspectOutput,
  runtimeCommand,
} from "./container-runtime.ts";

test("routes Linux runtime commands to native nerdctl", () => {
  assert.deepEqual(runtimeCommand("linux", "compose", ["ps"]), {
    command: "nerdctl",
    args: ["compose", "ps"],
  });
});

test("routes macOS runtime commands through Blame Lima Runtime", () => {
  assert.deepEqual(runtimeCommand("darwin", "volume", ["ls"]), {
    command: "blame-lima-runtime",
    args: ["volume", "ls"],
  });
});

test("routes Windows runtime commands through Blame WSL2 Runtime", () => {
  assert.deepEqual(runtimeCommand("win32", "network", ["ls"]), {
    command: "blame-wsl2-runtime",
    args: ["network", "ls"],
  });
});

test("routes Windows compose commands through Blame WSL2 Runtime", () => {
  assert.deepEqual(runtimeCommand("win32", "compose", ["ps"]), {
    command: "blame-wsl2-runtime",
    args: ["compose", "ps"],
  });
});

test("preserves runtime environment values", () => {
  const environment = containerRuntimeEnvironment({
    CONTAINERD_NAMESPACE: "blame",
  });

  assert.equal(environment.CONTAINERD_NAMESPACE, "blame");
  assert.equal(environment.BLAME_CONTAINER_RUNTIME, "blame-native");
});

test("parses inspect arrays and single objects", () => {
  assert.deepEqual(parseInspectOutput<{ Id: string }>('[{"Id":"one"}]'), [
    { Id: "one" },
  ]);
  assert.deepEqual(parseInspectOutput<{ Id: string }>('{"Id":"one"}'), [
    { Id: "one" },
  ]);
});
