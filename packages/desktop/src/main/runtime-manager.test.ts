import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeManager } from "./runtime-manager.ts";

test("checks Linux runtime with native nerdctl probes", async () => {
  const calls: string[] = [];
  const manager = createRuntimeManager({ platform: "linux" }, async (command, args) => {
    calls.push([command, ...args].join(" "));
    return "ok";
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "ready");
  assert.deepEqual(status.issues, []);
  assert.deepEqual(calls, [
    "nerdctl --version",
    "nerdctl info",
    "nerdctl compose version",
  ]);
});

test("uses passive managed runtime status checks", async () => {
  const calls: string[] = [];
  const manager = createRuntimeManager({ platform: "darwin" }, async (command, args) => {
    calls.push([command, ...args].join(" "));
    return "ready";
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "ready");
  assert.deepEqual(calls, [
    "blame-lima-runtime --version",
    "blame-lima-runtime status",
  ]);
  assert.equal(calls.some((call) => call.includes(" true")), false);
});

test("reports managed runtime binary failures as missing", async () => {
  const manager = createRuntimeManager({ platform: "win32" }, async () => {
    throw new Error("missing runtime");
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "missing");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "missing");
});

test("preserves managed runtime status output", async () => {
  const manager = createRuntimeManager({ platform: "darwin" }, async (_command, args) => {
    return args[0] === "status" ? "repairable" : "ok";
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "repairable");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "unavailable");
});

test("runs managed runtime lifecycle commands explicitly", async () => {
  const calls: string[] = [];
  const manager = createRuntimeManager({ platform: "win32" }, async (command, args) => {
    calls.push([command, ...args].join(" "));
    return "ready";
  });

  await manager.ensureRuntimeReady();
  await manager.repairRuntime();
  await manager.resetRuntime();
  await manager.uninstallRuntime();

  assert.deepEqual(calls, [
    "blame-wsl2-runtime ensure",
    "blame-wsl2-runtime --version",
    "blame-wsl2-runtime status",
    "blame-wsl2-runtime repair",
    "blame-wsl2-runtime --version",
    "blame-wsl2-runtime status",
    "blame-wsl2-runtime reset",
    "blame-wsl2-runtime --version",
    "blame-wsl2-runtime status",
    "blame-wsl2-runtime uninstall",
    "blame-wsl2-runtime --version",
    "blame-wsl2-runtime status",
  ]);
});

test("keeps Linux lifecycle operations lightweight", async () => {
  const calls: string[] = [];
  const manager = createRuntimeManager({ platform: "linux" }, async (command, args) => {
    calls.push([command, ...args].join(" "));
    return "ok";
  });

  await manager.ensureRuntimeReady();

  assert.deepEqual(calls, [
    "nerdctl --version",
    "nerdctl info",
    "nerdctl compose version",
  ]);
});
