import assert from "node:assert/strict";
import test from "node:test";
import {
  dockerComposeForPreview,
  dockerComposeWithCiForPackageInstalls,
  dockerComposeWithCorepackPnpm,
} from "./workspace-compose.ts";

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

test("does not rewrite pnpm commands already run through corepack", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - corepack prepare pnpm@10.32.1 --activate && corepack pnpm install --frozen-lockfile",
  ].join("\n");

  const result = dockerComposeWithCorepackPnpm(compose);

  assert.match(result, /&& corepack pnpm install --frozen-lockfile/);
  assert.doesNotMatch(result, /corepack corepack pnpm/);
});

test("adds CI to services running package installs", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    environment:",
    "      NODE_ENV: development",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - corepack pnpm install --frozen-lockfile && corepack pnpm dev",
  ].join("\n");

  const result = dockerComposeWithCiForPackageInstalls(compose);

  assert.match(result, /environment:\n      CI: "true"\n      NODE_ENV:/);
});

test("adds CI to list environments", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    environment:",
    "      - NODE_ENV=development",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - npm install && npm run dev",
  ].join("\n");

  const result = dockerComposeWithCiForPackageInstalls(compose);

  assert.match(result, /environment:\n      - CI=true\n      - NODE_ENV=/);
});

test("normalizes preview compose before writing it", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    volumes:",
    "      - .:/workspace",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - corepack prepare pnpm@10.32.1 --activate && corepack pnpm install --frozen-lockfile",
  ].join("\n");

  const result = dockerComposeForPreview(compose, "/tmp/project");

  assert.match(result, /user: "\$\{BLAME_HOST_UID\}:\$\{BLAME_HOST_GID\}"/);
  assert.match(result, /CI: "true"/);
  assert.doesNotMatch(result, /corepack corepack pnpm/);
});

test("adds host user for project root placeholder mounts", () => {
  const compose = [
    "services:",
    "  app:",
    "    volumes:",
    "      - ${BLAME_PROJECT_ROOT}:/workspace",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - corepack pnpm install && corepack pnpm dev",
  ].join("\n");

  const result = dockerComposeForPreview(compose, "/tmp/project");

  assert.match(result, /user: "\$\{BLAME_HOST_UID\}:\$\{BLAME_HOST_GID\}"/);
});

test("normalizes Windows project root placeholders for YAML", () => {
  const compose = [
    "services:",
    "  app:",
    "    volumes:",
    "      - ${BLAME_PROJECT_ROOT}:/workspace",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - npm install && npm run dev",
  ].join("\n");

  const result = dockerComposeForPreview(
    compose,
    String.raw`C:\Users\vanwa\Downloads\projet_test`,
  );

  assert.match(result, /C:\/Users\/vanwa\/Downloads\/projet_test:\/workspace/);
  assert.doesNotMatch(result, /C:\\Users/);
});
