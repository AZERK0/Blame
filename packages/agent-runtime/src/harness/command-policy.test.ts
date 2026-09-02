import assert from "node:assert/strict";
import test from "node:test";
import { blockedCommandReason } from "./command-policy.js";
import { workspaceCommandEnvironment } from "./workspace-command-environment.js";

test("allows printf when it only writes to stdout", () => {
  assert.equal(blockedCommandReason("printf 'entries='"), undefined);
  assert.equal(
    blockedCommandReason("printf 'entries=' && grep -c item source.ts"),
    undefined,
  );
  assert.match(
    blockedCommandReason("printf unsafe > source.ts") ?? "",
    /redirection/u,
  );
});

test("removes pnpm-only npm configuration for npm tasks", () => {
  const environment = {
    BLAME_API_TOKEN: "secret",
    NODE_ENV: "development",
    PATH: "/usr/bin",
    npm_config_catalog: "catalog:value",
    npm_config_globalconfig: "/tmp/pnpm-config",
    npm_config_registry: "https://registry.example.test",
  };
  assert.deepEqual(workspaceCommandEnvironment(environment, "npm"), {
    PATH: "/usr/bin",
    npm_config_registry: "https://registry.example.test",
  });
  assert.equal(
    workspaceCommandEnvironment(environment, "pnpm").npm_config_catalog,
    "catalog:value",
  );
});
