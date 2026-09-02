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

test("distinguishes heredoc comparisons from shell output redirection", () => {
  const inspection = [
    "python3 - <<'PY'",
    "size = 12000",
    "assert size > 10000",
    "print(size)",
    "PY",
  ].join("\n");
  assert.equal(blockedCommandReason(inspection), undefined);
  assert.match(
    blockedCommandReason(`${inspection}\nprintf unsafe > source.ts`) ?? "",
    /redirection/u,
  );
  assert.match(
    blockedCommandReason(`${inspection}\nopen('source.ts', 'w')`) ?? "",
    /edit_code/u,
  );
});

test("removes pnpm-only npm configuration for npm tasks", () => {
  const environment = {
    BLAME_API_TOKEN: "secret",
    NODE_ENV: "development",
    PATH: "/usr/bin",
    npm_config_catalog: "catalog:value",
    npm_config_globalconfig: "/tmp/pnpm-config",
    npm_config_npm_globalconfig: "/tmp/pnpm-npm-config",
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
