import { spawn } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDownloadObjectStorage } from "./download-object-storage.mjs";
import { loadEnvFiles, requiredEnv } from "./env-files.mjs";
import { sha256File } from "./file-sha256.mjs";
import {
  macosImagePublicBaseUrl,
  rootfsPublicBaseUrl,
} from "./runtime-manifest.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(rootDir, "packages/desktop");
const outputRoot = join(desktopDir, "dist/runtime");
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);
const platform = valueArg("--platform") ?? "all";

await loadEnvFiles(rootDir);

if (["build", "deploy", "release"].includes(command)) {
  await runPlatforms(command);
  if (command === "deploy" || command === "release")
    await publishRuntimeManifest();
} else {
  printHelp();
  process.exit(command === "help" ? 0 : 1);
}

async function runPlatforms(operation) {
  for (const target of selectedPlatforms()) {
    const script =
      target === "windows"
        ? "scripts/windows-runtime-rootfs.mjs"
        : "scripts/macos-runtime-image.mjs";
    await run(process.execPath, [script, operation, ...platformArgs(target)]);
  }
}

function selectedPlatforms() {
  if (platform === "all") return ["windows", "macos"];
  if (platform === "windows" || platform === "macos") return [platform];
  throw new Error(`Unsupported runtime platform: ${platform}`);
}

function platformArgs(target) {
  const forwarded = [];
  if (args.includes("--all-architectures"))
    forwarded.push("--all-architectures");
  const targetArchitecture = valueArg(
    target === "windows" ? "--windows-arch" : "--macos-arch",
  );
  const architecture =
    targetArchitecture ??
    (platform === target ? valueArg("--arch") : undefined);
  if (architecture) forwarded.push("--arch", architecture);
  return forwarded;
}

async function publishRuntimeManifest() {
  const runtimeVersion = requiredEnv("BLAME_RUNTIME_VERSION");
  const manifest = {
    runtimeVersion,
    artifacts: {
      windows: await platformArtifacts(
        "windows",
        rootfsPublicBaseUrl(runtimeVersion),
        runtimeVersion,
      ),
      macos: await platformArtifacts(
        "macos",
        macosImagePublicBaseUrl(runtimeVersion),
        runtimeVersion,
      ),
    },
  };
  assertCompleteManifest(manifest);

  const manifestDir = join(outputRoot, `v${runtimeVersion}`);
  const manifestPath = join(manifestDir, "manifest.json");
  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await uploadManifest(manifestPath, runtimeVersion);
  console.log(`Published runtime manifest for v${runtimeVersion}`);
}

async function platformArtifacts(platformName, baseUrl, runtimeVersion) {
  if (!baseUrl)
    throw new Error(
      "BLAME_RUNTIME_BASE_URL or BLAME_DOWNLOAD_BASE_URL is required",
    );
  const directory = join(outputRoot, platformName);
  const entries = await readdir(directory);
  const artifacts = {};
  for (const entry of entries) {
    const architecture = artifactArchitecture(
      platformName,
      entry,
      runtimeVersion,
    );
    if (!architecture) continue;
    const file = join(directory, entry);
    artifacts[architecture] = {
      url: `${baseUrl}/${entry}`,
      sha256: await sha256File(file),
      size: (await stat(file)).size,
    };
  }
  return artifacts;
}

function artifactArchitecture(platformName, fileName, runtimeVersion) {
  if (!fileName.includes(`-v${runtimeVersion}.`)) return undefined;
  if (platformName === "windows")
    return fileName.match(/blame-runtime-wsl-(amd64|arm64)-v/)?.[1];
  return fileName.match(/blame-runtime-lima-(x86_64|aarch64)-v/)?.[1];
}

function assertCompleteManifest(manifest) {
  const required = [
    manifest.artifacts.windows.amd64,
    manifest.artifacts.windows.arm64,
    manifest.artifacts.macos.x86_64,
    manifest.artifacts.macos.aarch64,
  ];
  if (required.some((artifact) => !artifact?.url || !artifact?.sha256)) {
    throw new Error(
      "Both architectures of the Windows and macOS runtimes are required before publishing.",
    );
  }
}

async function uploadManifest(manifestPath, runtimeVersion) {
  await createDownloadObjectStorage().uploadVersioned(
    [manifestPath],
    `runtime/v${runtimeVersion}`,
  );
}

function valueArg(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function run(commandName, commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(commandName, commandArgs, {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `${commandName} ${commandArgs.join(" ")} exited with ${code}`,
          ),
        );
    });
  });
}

function printHelp() {
  console.log(
    "Usage: node scripts/runtime-release.mjs <build|deploy|release> [--platform all|windows|macos] [--all-architectures] [--windows-arch amd64,arm64] [--macos-arch x86_64,aarch64]",
  );
}
