import { basename } from "node:path";

const pnpmOnlyNpmConfiguration = new Set([
  "npm_config__jsr_registry",
  "npm_config_catalog",
  "npm_config_globalconfig",
  "npm_config_npm_globalconfig",
  "npm_config_overrides",
  "npm_config_verify_deps_before_run",
]);

export function workspaceCommandEnvironment(
  environment = process.env,
  executable?: string,
) {
  const npmTask = executable && basename(executable).toLowerCase() === "npm";
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        name !== "NODE_ENV" &&
        name !== "NODE_TEST_CONTEXT" &&
        !name.startsWith("BLAME_") &&
        !(npmTask && pnpmOnlyNpmConfiguration.has(name.toLowerCase())),
    ),
  );
}
