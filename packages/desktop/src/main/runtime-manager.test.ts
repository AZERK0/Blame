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
    "blame-lima-runtime agent status",
  ]);
  assert.equal(calls.some((call) => call.includes(" true")), false);
});

test("requires the managed runtime agent to execute", async () => {
  const manager = createRuntimeManager(
    { platform: "win32" },
    async (_command, args) => {
      if (args[0] === "agent")
        throw new Error("blame-runtime-agent: command not found");
      return "ready";
    },
  );

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "missing");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "missing");
  assert.match(status.issues[0]?.action ?? "", /Repair BlameRuntime/);
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

test("uses managed runtime status checks from JSON output", async () => {
  const manager = createRuntimeManager({ platform: "win32" }, async (_command, args) => {
    if (args[0] !== "status") return "ok";
    return JSON.stringify({
      status: "unsupported",
      checks: [
        {
          action: "Enable WSL2, then run Blame runtime setup again.",
          name: "wsl",
          status: "unsupported",
        },
      ],
    });
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "unsupported");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "unsupported");
  assert.match(status.issues[0]?.action ?? "", /Enable WSL2/);
});

test("reports missing managed runtime Git as repairable", async () => {
  const manager = createRuntimeManager({ platform: "win32" }, async (_command, args) => {
    if (args[0] !== "status") return "ok";
    return JSON.stringify({
      status: "repairable",
      checks: [
        { name: "wsl", status: "available" },
        { name: "distro", status: "available" },
        { name: "git", status: "missing" },
      ],
    });
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "repairable");
  assert.equal(status.issues[0]?.name, "git");
  assert.equal(status.issues[0]?.status, "missing");
});

test("reports missing Windows runtime Cline SDK as repairable", async () => {
  const manager = createRuntimeManager({ platform: "win32" }, async (_command, args) => {
    if (args[0] !== "status") return "ok";
    return JSON.stringify({
      status: "repairable",
      checks: [
        { name: "wsl", status: "available" },
        { name: "distro", status: "available" },
        { name: "cline-sdk", status: "missing" },
      ],
    });
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "repairable");
  assert.equal(status.issues[0]?.name, "cline-sdk");
  assert.equal(status.issues[0]?.status, "missing");
});

test("reports missing bundled Lima as managed runtime missing", async () => {
  const manager = createRuntimeManager({ platform: "darwin" }, async (_command, args) => {
    if (args[0] !== "status") return "ok";
    return JSON.stringify({
      status: "missing",
      checks: [
        {
          action: "Package bundled Lima resources with Blame, then run Blame runtime setup again.",
          name: "lima",
          status: "missing",
        },
      ],
    });
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "missing");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "missing");
  assert.match(status.issues[0]?.action ?? "", /bundled Lima/);
});

test("reports missing Blame Lima VM as managed runtime missing", async () => {
  const manager = createRuntimeManager({ platform: "darwin" }, async (_command, args) => {
    if (args[0] !== "status") return "ok";
    return JSON.stringify({
      status: "missing",
      checks: [
        { name: "lima", status: "available" },
        {
          action: "Create or repair the BlameRuntime Lima VM from Blame runtime setup.",
          name: "vm",
          status: "missing",
        },
      ],
    });
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "missing");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "missing");
  assert.match(status.issues[0]?.action ?? "", /BlameRuntime Lima VM/);
});

test("reports stopped Blame Lima VM as repairable", async () => {
  const manager = createRuntimeManager({ platform: "darwin" }, async (_command, args) => {
    if (args[0] !== "status") return "ok";
    return JSON.stringify({
      status: "repairable",
      checks: [
        { name: "lima", status: "available" },
        {
          action: "Create or repair the BlameRuntime Lima VM from Blame runtime setup.",
          name: "vm",
          status: "unavailable",
        },
      ],
    });
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "repairable");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "unavailable");
});

test("reports missing Lima host mount as runtime repair action", async () => {
  const manager = createRuntimeManager({ platform: "darwin" }, async (_command, args) => {
    if (args[0] !== "status") return "ok";
    return JSON.stringify({
      status: "repairable",
      checks: [
        { name: "lima", status: "available" },
        { name: "vm", status: "available" },
        {
          action: "Reset BlameRuntime from Blame runtime setup so macOS project folders are mounted.",
          name: "host-home",
          status: "missing",
        },
      ],
    });
  });

  const status = await manager.checkRuntimeDependencies();

  assert.equal(status.status, "repairable");
  assert.equal(status.issues[0]?.name, "blame-runtime");
  assert.equal(status.issues[0]?.status, "missing");
  assert.match(status.issues[0]?.action ?? "", /Reset BlameRuntime/);
});


test("runs managed runtime lifecycle commands explicitly", async () => {
  const calls: string[] = [];
  const timeouts: Array<number | undefined> = [];
  const manager = createRuntimeManager({ platform: "win32" }, async (command, args, _env, timeoutMs) => {
    calls.push([command, ...args].join(" "));
    timeouts.push(timeoutMs);
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
    "blame-wsl2-runtime agent status",
    "blame-wsl2-runtime repair",
    "blame-wsl2-runtime --version",
    "blame-wsl2-runtime status",
    "blame-wsl2-runtime agent status",
    "blame-wsl2-runtime reset",
    "blame-wsl2-runtime --version",
    "blame-wsl2-runtime status",
    "blame-wsl2-runtime agent status",
    "blame-wsl2-runtime uninstall",
    "blame-wsl2-runtime --version",
    "blame-wsl2-runtime status",
    "blame-wsl2-runtime agent status",
  ]);
  assert.deepEqual(timeouts, [
    1_800_000,
    undefined,
    undefined,
    undefined,
    1_800_000,
    undefined,
    undefined,
    undefined,
    1_800_000,
    undefined,
    undefined,
    undefined,
    1_800_000,
    undefined,
    undefined,
    undefined,
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
