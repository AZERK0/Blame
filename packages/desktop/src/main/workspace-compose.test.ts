import assert from "node:assert/strict";
import test from "node:test";
import {
  composeWithNonMutatingNpmInstalls,
  composeWithoutNumericSuUser,
  composeWithAllocatedHostPorts,
  dockerComposeForPreview,
  dockerComposeWithCiForPackageInstalls,
  dockerComposeWithCorepackPnpm,
  dockerComposeWithDependencyVolumes,
} from "./workspace-compose.ts";

test("allocates explicit localhost ports for runtime previews", async () => {
  const compose = [
    "services:",
    "  web:",
    "    ports:",
    '      - "127.0.0.1::3000"',
  ].join("\n");

  const result = await composeWithAllocatedHostPorts(compose);

  assert.match(result, /"127\.0\.0\.1:[0-9]+:3000"/);
  assert.doesNotMatch(result, /127\.0\.0\.1::3000/);
});

test("materializes preview public origins from allocated ports", async () => {
  const compose = [
    "services:",
    "  web:",
    "    environment:",
    '      BETTER_AUTH_URL: "http://localhost:3000"',
    '      NEXTAUTH_URL: "http://127.0.0.1:3000/api/auth"',
    "    ports:",
    '      - "127.0.0.1::3000"',
  ].join("\n");

  const result = await composeWithAllocatedHostPorts(compose);
  const hostPort = /127\.0\.0\.1:(\d+):3000/.exec(result)?.[1];

  assert.ok(hostPort);
  assert.match(result, new RegExp(`BETTER_AUTH_URL: "http://127\\.0\\.0\\.1:${hostPort}"`));
  assert.match(result, new RegExp(`NEXTAUTH_URL: "http://127\\.0\\.0\\.1:${hostPort}/api/auth"`));
});

test("keeps explicit localhost ports unchanged", async () => {
  const compose = [
    "services:",
    "  web:",
    "    ports:",
    '      - "127.0.0.1:4173:3000"',
  ].join("\n");

  const result = await composeWithAllocatedHostPorts(compose);

  assert.equal(result, compose);
});

test("uses explicit localhost ports for public origin materialization", async () => {
  const compose = [
    "services:",
    "  web:",
    "    environment:",
    "      - APP_URL=http://localhost:3000",
    "    ports:",
    '      - "127.0.0.1:4173:3000"',
  ].join("\n");

  const result = await composeWithAllocatedHostPorts(compose);

  assert.match(result, /APP_URL=http:\/\/127\.0\.0\.1:4173/);
});

test("removes invalid numeric su user commands", () => {
  const compose = [
    "services:",
    "  deps:",
    "    command: >-",
    "      bash -lc \"chown -R ${BLAME_HOST_UID}:${BLAME_HOST_GID} /workspace/node_modules && su -s /bin/bash -c 'corepack pnpm install' '#${BLAME_HOST_UID}'\"",
  ].join("\n");

  const result = composeWithoutNumericSuUser(compose);

  assert.match(result, /bash -lc 'corepack pnpm install'/);
  assert.doesNotMatch(result, /'#\$\{BLAME_HOST_UID\}'/);
});

test("uses non-mutating npm installs for runtime previews", () => {
  const compose = [
    "services:",
    "  app:",
    '    command: ["sh", "-c", "npm install --cache /npm-cache && npx nuxt dev"]',
  ].join("\n");

  const result = composeWithNonMutatingNpmInstalls(compose);

  assert.match(
    result,
    /npm install --no-package-lock --cache \/npm-cache && npx nuxt dev/,
  );
  assert.doesNotMatch(result, /npm ci/);
});

test("keeps already non-mutating npm installs unchanged", () => {
  const compose = [
    "services:",
    "  app:",
    '    command: "npm install --no-package-lock && npm run dev"',
  ].join("\n");

  const result = composeWithNonMutatingNpmInstalls(compose);

  assert.equal(result, compose);
});

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
    "      - corepack prepare pnpm@9.12.2 --activate && corepack pnpm install --frozen-lockfile && corepack pnpm dev",
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

  assert.doesNotMatch(result, /user: "\$\{BLAME_HOST_UID\}:\$\{BLAME_HOST_GID\}"/);
  assert.match(result, /CI: "true"/);
  assert.doesNotMatch(result, /corepack corepack pnpm/);
});

test("escapes container shell variables in preview commands", () => {
  const compose = [
    "services:",
    "  preview:",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - |",
    "        export HOME=/tmp/blame-home",
    '        mkdir -p "$HOME" "${NPM_CONFIG_CACHE}"',
    '        echo "${BLAME_HOST_UID}:${BLAME_HOST_GID}"',
    "    environment:",
    "      NODE_ENV: development",
  ].join("\n");

  const result = dockerComposeForPreview(compose, "/tmp/project");

  assert.match(result, /mkdir -p "\$\$HOME" "\$\$\{NPM_CONFIG_CACHE\}"/);
  assert.match(result, /echo "\$\{BLAME_HOST_UID\}:\$\{BLAME_HOST_GID\}"/);
  assert.match(result, /NODE_ENV: development/);
});

test("does not force host uid user for rootless runtime mounts", () => {
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

  assert.doesNotMatch(result, /user: "\$\{BLAME_HOST_UID\}:\$\{BLAME_HOST_GID\}"/);
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

test("adds runtime dependency volumes for pnpm worktree installs", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    volumes:",
    "      - .:/workspace",
    "    command:",
    "      - bash",
    "      - -lc",
    "      - corepack prepare pnpm@9.12.2 --activate && corepack pnpm install --frozen-lockfile && corepack pnpm dev",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(result, /blame-dependencies-init:/);
  assert.match(result, /"blame_node_modules:\/workspace\/node_modules"/);
  assert.match(result, /"blame_corepack_cache:\/tmp\/corepack-cache"/);
  assert.match(result, /"blame_pnpm_store:\/pnpm\/store"/);
  assert.match(result, /COREPACK_HOME: "\/tmp\/corepack-cache"/);
  assert.match(result, /npm_config_store_dir: "\/pnpm\/store"/);
  assert.match(result, /depends_on:\n      - blame-dependencies-init/);
  assert.match(
    result,
    /blame_corepack_cache:\n    name: blame_corepack_cache\n    external: true/,
  );
  assert.match(
    result,
    /blame_pnpm_store:\n    name: blame_pnpm_store\n    external: true/,
  );
});

test("preserves list environment while adding npm cache volume", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    environment:",
    "      - NODE_ENV=development",
    "    volumes:",
    "      - .:/app",
    "    command:",
    "      - npm install && npm run dev",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(
    result,
    /environment:\n      - NPM_CONFIG_CACHE=\/npm\/cache\n      - NODE_ENV=development/,
  );
  assert.match(result, /"blame_node_modules:\/app\/node_modules"/);
  assert.match(result, /"blame_npm_cache:\/npm\/cache"/);
});

test("adds shared Yarn cache for plain yarn install", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    volumes:",
    "      - .:/app",
    "    command:",
    "      - yarn install && yarn dev",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(result, /"blame_node_modules:\/app\/node_modules"/);
  assert.match(result, /"blame_yarn_cache:\/yarn\/cache"/);
  assert.match(result, /YARN_CACHE_FOLDER: "\/yarn\/cache"/);
  assert.match(
    result,
    /blame_yarn_cache:\n    name: blame_yarn_cache\n    external: true/,
  );
});

test("adds shared Bun cache for bun install", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    volumes:",
    "      - .:/app",
    "    command:",
    "      - bun install && bun run dev",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(result, /"blame_node_modules:\/app\/node_modules"/);
  assert.match(result, /"blame_bun_cache:\/bun\/cache"/);
  assert.match(result, /BUN_INSTALL_CACHE_DIR: "\/bun\/cache"/);
  assert.match(
    result,
    /blame_bun_cache:\n    name: blame_bun_cache\n    external: true/,
  );
});

test("detects portable Windows project root mounts for dependency volumes", () => {
  const compose = [
    "services:",
    "  frontend:",
    "    volumes:",
    "      - C:/Users/dev/project:/workspace",
    "    command:",
    "      - corepack pnpm install && corepack pnpm dev",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(
    compose,
    String.raw`C:\Users\dev\project`,
  );

  assert.match(result, /"blame_node_modules:\/workspace\/node_modules"/);
  assert.match(result, /"blame_pnpm_store:\/pnpm\/store"/);
});

test("promotes existing package cache volumes to global runtime volumes", () => {
  const compose = [
    "services:",
    "  deps:",
    "    volumes:",
    "      - .:/workspace",
    "      - corepack_cache:/tmp/corepack-cache",
    "      - pnpm_store:/pnpm/store",
    "    command:",
    "      - corepack prepare pnpm@9.12.2 --activate && corepack pnpm install",
    "volumes:",
    "  corepack_cache:",
    "  pnpm_store:",
    "  node_modules:",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(
    result,
    /corepack_cache:\n    name: blame_corepack_cache\n    external: true/,
  );
  assert.match(
    result,
    /pnpm_store:\n    name: blame_pnpm_store\n    external: true/,
  );
  assert.doesNotMatch(result, /node_modules:\n    name:/);
});

test("does not orphan global volume metadata when cache volume already exists", () => {
  const compose = [
    "services:",
    "  deps:",
    "    volumes:",
    "      - blame_pnpm_store:/pnpm/store",
    "    command: corepack pnpm install",
    "volumes:",
    "  blame_pnpm_store:",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(
    result,
    /volumes:\n  blame_pnpm_store:\n    name: blame_pnpm_store\n    external: true/,
  );
  assert.doesNotMatch(result, /volumes:\n    name:/);
});

test("replaces project-scoped package cache volume names", () => {
  const compose = [
    "services:",
    "  deps:",
    "    volumes:",
    "      - .:/workspace",
    "      - pnpm_store:/pnpm/store",
    "      - corepack_cache:/tmp/corepack-cache",
    "    command:",
    "      - corepack prepare pnpm@9.12.2 --activate && corepack pnpm install",
    "volumes:",
    "  node_modules:",
    "    name: ${COMPOSE_PROJECT_NAME:-demo}_node_modules",
    "  pnpm_store:",
    "    name: ${COMPOSE_PROJECT_NAME:-demo}_pnpm_store",
    "  corepack_cache:",
    "    name: ${COMPOSE_PROJECT_NAME:-demo}_corepack_cache",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(
    result,
    /node_modules:\n    name: \$\{COMPOSE_PROJECT_NAME:-demo\}_node_modules/,
  );
  assert.match(
    result,
    /pnpm_store:\n    name: blame_pnpm_store\n    external: true/,
  );
  assert.match(
    result,
    /corepack_cache:\n    name: blame_corepack_cache\n    external: true/,
  );
});

test("preserves mapping depends_on when adding dependency init service", () => {
  const compose = [
    "services:",
    "  setup:",
    "    image: node:20",
    "  deps:",
    "    depends_on:",
    "      setup:",
    "        condition: service_completed_successfully",
    "    volumes:",
    "      - .:/workspace",
    "    command:",
    "      - npm install",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.match(
    result,
    /depends_on:\n      blame-dependencies-init:\n        condition: service_completed_successfully\n      setup:\n        condition: service_completed_successfully/,
  );
  assert.doesNotMatch(
    result,
    /depends_on:\n      - blame-dependencies-init\n      setup:/,
  );
});

test("uses existing pnpm store mount instead of adding a second store", () => {
  const compose = [
    "services:",
    "  deps:",
    "    volumes:",
    "      - .:/workspace",
    "      - pnpm_store:/tmp/pnpm-store",
    "    command:",
    "      - corepack pnpm install --store-dir /tmp/pnpm-store",
    "volumes:",
    "  pnpm_store:",
    "    name: ${COMPOSE_PROJECT_NAME:-demo}_pnpm_store",
  ].join("\n");

  const result = dockerComposeWithDependencyVolumes(compose, "/tmp/project");

  assert.doesNotMatch(result, /blame_pnpm_store:\/pnpm\/store/);
  assert.match(
    result,
    /pnpm_store:\n    name: blame_pnpm_store\n    external: true/,
  );
});
