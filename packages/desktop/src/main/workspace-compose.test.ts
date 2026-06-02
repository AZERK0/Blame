import assert from "node:assert/strict";
import test from "node:test";
import { dockerComposeWithCorepackPnpm } from "./workspace-compose.ts";

test("prefixes pnpm commands without rewriting pnpm paths", () => {
  const compose = [
    "services:",
    "  pnpm-cache-init:",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - mkdir -p /pnpm/store /pnpm/home && chown -R ${BLAME_HOST_UID}:${BLAME_HOST_GID} /pnpm /workspace",
    "  frontend:",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - corepack prepare pnpm@10.32.1 --activate && pnpm install --frozen-lockfile",
  ].join("\n");

  const result = dockerComposeWithCorepackPnpm(compose);

  assert.match(result, /chown -R .+ \/pnpm \/workspace/);
  assert.doesNotMatch(result, /\/corepack pnpm/);
  assert.match(result, /&& corepack pnpm install --frozen-lockfile/);
});
