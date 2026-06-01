import assert from "node:assert/strict";
import test from "node:test";
import {
  checkHostDependencies,
  parseNodeMajorVersion,
  requiresNodeTooling,
} from "./host-dependencies.ts";

test("parses node major versions", () => {
  assert.equal(parseNodeMajorVersion("v22.12.0"), 22);
  assert.equal(parseNodeMajorVersion("24.14.1"), 24);
  assert.equal(parseNodeMajorVersion("not-a-version"), null);
});

test("detects node tooling only when setup script needs it", () => {
  assert.equal(requiresNodeTooling("echo node_modules"), false);
  assert.equal(requiresNodeTooling("# pnpm install\necho ready"), false);
  assert.equal(requiresNodeTooling("corepack pnpm install"), true);
  assert.equal(requiresNodeTooling("npm install"), true);
});

test("passes when required host dependencies are available", async () => {
  const calls: string[] = [];
  const report = await checkHostDependencies(
    { platform: "linux", setupScript: "echo ready" },
    async (command, args) => {
      calls.push([command, ...args].join(" "));
      return "ok";
    },
  );

  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  assert.equal(calls.includes("node --version"), false);
});

test("reports missing git before setup execution", async () => {
  const report = await checkHostDependencies(
    { platform: "darwin", setupScript: "echo ready" },
    async (command) => {
      if (command === "git") throw new Error("missing");
      return "ok";
    },
  );

  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.name, "git");
  assert.match(report.issues[0]?.action ?? "", /Xcode|brew/);
});

test("reports unavailable docker daemon separately from docker cli", async () => {
  const report = await checkHostDependencies(
    { platform: "win32", setupScript: "echo ready" },
    async (command, args) => {
      if (command === "docker" && args[0] === "info") {
        throw new Error("daemon unavailable");
      }
      return "ok";
    },
  );

  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.name, "docker-daemon");
  assert.equal(report.issues[0]?.status, "unavailable");
  assert.match(report.issues[0]?.action ?? "", /Docker Desktop/);
});

test("does not cascade docker checks when docker cli is missing", async () => {
  const report = await checkHostDependencies(
    { platform: "linux", setupScript: "echo ready" },
    async (command) => {
      if (command === "docker") throw new Error("docker missing");
      return "ok";
    },
  );

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.name),
    ["docker"],
  );
});

test("reports missing docker compose plugin", async () => {
  const report = await checkHostDependencies(
    { platform: "linux", setupScript: "echo ready" },
    async (command, args) => {
      if (command === "docker" && args.join(" ") === "compose version") {
        throw new Error("compose missing");
      }
      return "ok";
    },
  );

  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.name, "docker-compose");
  assert.match(report.issues[0]?.action ?? "", /Compose plugin/);
});

test("checks node and corepack when setup script needs package tooling", async () => {
  const calls: string[] = [];
  const report = await checkHostDependencies(
    { platform: "linux", setupScript: "pnpm install" },
    async (command, args) => {
      calls.push([command, ...args].join(" "));
      if (command === "node") return "v22.12.0";
      return "ok";
    },
  );

  assert.equal(report.ok, true);
  assert.equal(calls.includes("node --version"), true);
  assert.equal(calls.includes("corepack --version"), true);
});

test("reports unsupported node versions", async () => {
  const report = await checkHostDependencies(
    { platform: "linux", setupScript: "npm install" },
    async (command) => {
      if (command === "node") return "v20.18.1";
      return "ok";
    },
  );

  assert.equal(report.ok, false);
  assert.equal(report.issues[0]?.name, "node");
  assert.equal(report.issues[0]?.status, "unsupported");
});
