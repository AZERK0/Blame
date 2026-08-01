import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudDisabled,
  cloudOwner,
  completedCloudMetadata,
  localSetupRequired,
  mergeCloudServers,
  type McpSettings,
} from "./mcp-cloud-sync.ts";

const userId = "01981221-2b74-7bc0-a1f5-9f9c58f0e050";

test("disables a cloud server until its local setup is completed", () => {
  const merged = mergeCloudServers(
    emptySettings(),
    userId,
    [cloudServer(false)],
    false,
  );
  const server = merged.mcpServers.Dokploy;

  assert.ok(server);
  assert.equal(server.disabled, true);
  assert.equal(localSetupRequired(server), true);
  assert.equal(cloudDisabled(server), false);
  assert.equal(cloudOwner(server), userId);
  assert.equal(server.timeout, 45);
});

test("keeps a cloud placeholder incomplete across repeated merges", () => {
  const firstMerge = mergeCloudServers(
    emptySettings(),
    userId,
    [cloudServer(false)],
    false,
  );
  const secondMerge = mergeCloudServers(
    firstMerge,
    userId,
    [cloudServer(false)],
    false,
  );
  const server = secondMerge.mcpServers.Dokploy;

  assert.ok(server);
  assert.equal(server.disabled, true);
  assert.equal(localSetupRequired(server), true);
  assert.equal(cloudDisabled(server), false);
});

test("preserves a disabled cloud state while local setup is incomplete", () => {
  const merged = mergeCloudServers(
    emptySettings(),
    userId,
    [cloudServer(true)],
    false,
  );
  const server = merged.mcpServers.Dokploy;

  assert.ok(server);
  assert.equal(server.disabled, true);
  assert.equal(localSetupRequired(server), true);
  assert.equal(cloudDisabled(server), true);
});

test("adopts a matching local server without losing local-only fields", () => {
  const settings: McpSettings = {
    mcpServers: {
      Dokploy: {
        args: ["-y", "@dokploy/mcp"],
        command: "npx",
        disabled: false,
        env: { DOKPLOY_TOKEN: "secret" },
        type: "stdio",
      },
    },
  };

  const merged = mergeCloudServers(
    settings,
    userId,
    [cloudServer(false)],
    true,
  );
  const server = merged.mcpServers.Dokploy;

  assert.ok(server);
  assert.deepEqual(server.args, ["-y", "@dokploy/mcp"]);
  assert.deepEqual(server.env, { DOKPLOY_TOKEN: "secret" });
  assert.equal(server.disabled, false);
  assert.equal(localSetupRequired(server), false);
});

test("clears setup metadata while preserving cloud ownership", () => {
  const merged = mergeCloudServers(
    emptySettings(),
    userId,
    [cloudServer(false)],
    false,
  );
  const server = merged.mcpServers.Dokploy;

  assert.ok(server);
  const metadata = completedCloudMetadata(server);
  assert.deepEqual(metadata, { blameCloudUserId: userId });
});

function emptySettings(): McpSettings {
  return { mcpServers: {} };
}

function cloudServer(disabled: boolean) {
  return {
    command: "npx",
    disabled,
    name: "Dokploy",
    timeout: 45,
    transport: "stdio" as const,
  };
}
