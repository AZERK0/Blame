import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDownloadObjectStorage } from "./download-object-storage.mjs";
import { loadEnvFiles, requiredEnv } from "./env-files.mjs";
import { sha256File } from "./file-sha256.mjs";
import { runtimeLimaImageFileName, runtimeRootfsFileName } from "./runtime-manifest.mjs";

const architectures = { windows: ["amd64", "arm64"], macos: ["x86_64", "aarch64"] };

export function runtimeStagingPrefix(source) {
  if (!/^\d+\/\d+$/.test(source)) throw new Error("Runtime staging source must be run_id/attempt");
  return `_staging/runtime/${source}`;
}

function runtimeFile(platform, architecture, version) {
  if (!architectures[platform]?.includes(architecture)) throw new Error("Unsupported runtime target");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(version)) throw new Error("Invalid runtime version");
  return platform === "windows" ? runtimeRootfsFileName(architecture, version) : runtimeLimaImageFileName(architecture, version);
}

export async function stageRuntimeArtifact(storage, options) {
  const { source, platform, architecture, version, directory } = options;
  const prefix = `${runtimeStagingPrefix(source)}/${platform}`;
  const name = runtimeFile(platform, architecture, version);
  const file = join(directory, platform, name);
  const temporary = await mkdtemp(join(tmpdir(), "runtime-transfer-"));
  try {
    const metadata = join(temporary, `${name}.json`);
    await writeFile(metadata, JSON.stringify({ sha256: await sha256File(file) }));
    await storage.uploadStaged([file], prefix);
    await storage.uploadStaged([metadata], prefix);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function restoreRuntimeArtifacts(storage, options) {
  const prefix = runtimeStagingPrefix(options.source);
  for (const [platform, targets] of Object.entries(architectures)) {
    for (const architecture of targets) {
      const name = runtimeFile(platform, architecture, options.version);
      await restoreRuntimeArtifact(storage, `${prefix}/${platform}/${name}`, join(options.directory, platform, name));
    }
  }
}

async function restoreRuntimeArtifact(storage, key, destination) {
  const metadata = JSON.parse(await storage.objectText(`${key}.json`));
  if (!/^[a-f0-9]{64}$/.test(metadata.sha256 ?? "")) throw new Error(`Invalid checksum for ${key}`);
  await mkdir(dirname(destination), { recursive: true });
  await storage.download(key, destination);
  if (await sha256File(destination) !== metadata.sha256) {
    await rm(destination, { force: true });
    throw new Error(`Runtime transfer checksum mismatch for ${key}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnvFiles(process.cwd());
  const [command, source, platform, architecture] = process.argv.slice(2);
  const prefix = runtimeStagingPrefix(source);
  const storage = createDownloadObjectStorage();
  const options = { source, platform, architecture, version: requiredEnv("BLAME_RUNTIME_VERSION"), directory: "packages/desktop/dist/runtime" };
  if (command === "stage") await stageRuntimeArtifact(storage, options);
  else if (command === "restore") await restoreRuntimeArtifacts(storage, options);
  else if (command === "cleanup") await storage.deletePrefix(prefix);
  else throw new Error("Expected stage, restore or cleanup");
}
