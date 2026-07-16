import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./env-files.mjs";
import { prepareRuntimeManifests } from "./runtime-manifest.mjs";

export * from "./runtime-manifest.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFiles(rootDir);
  const runtimeRoot = join(rootDir, "packages/desktop/resources/runtime");
  await prepareRuntimeManifests(
    process.argv[2] ? resolve(process.argv[2]) : runtimeRoot,
  );
}
