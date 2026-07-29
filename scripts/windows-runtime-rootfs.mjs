import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDownloadObjectStorage } from "./download-object-storage.mjs";
import {
  loadEnvFiles,
  requiredEnv,
  text,
  upsertEnvValues,
} from "./env-files.mjs";
import { sha256File } from "./file-sha256.mjs";
import {
  rootfsPublicBaseUrl,
  runtimeRootfsFileName,
} from "./windows-runtime-manifest.mjs";
import { runtimeClineSdkVersion } from "./runtime-sdk-version.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(rootDir, "packages/desktop");
const dockerfile = join(rootDir, "deploy/runtime-builder/Dockerfile.wsl");
const outputDir = join(desktopDir, "dist/runtime/windows");
const envFile = join(rootDir, ".env.local");
const architectures = ["amd64", "arm64"];
const command = process.argv[2] ?? "help";
const rawArgs = process.argv.slice(3);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

await loadEnvFiles(rootDir);

if (command === "build") await buildRootfs();
else if (command === "deploy") await deployRootfs();
else if (command === "release") {
  await buildRootfs();
  await deployRootfs();
} else {
  printHelp();
  process.exit(command === "help" ? 0 : 1);
}

async function buildRootfs() {
  await assertExecutableExists(
    "docker",
    "Docker is required to build WSL runtime images.",
  );
  await mkdir(outputDir, { recursive: true });
  for (const architecture of selectedArchitectures()) {
    await buildArchitecture(architecture);
  }
}

async function buildArchitecture(architecture) {
  const runtimeVersion = requiredRuntimeVersion();
  const clineSdkVersion = await runtimeClineSdkVersion();
  const buildId = `${runtimeVersion}-${architecture}-${process.pid}`;
  const image = `blame-runtime-wsl-build:${buildId}`;
  const container = `blame-runtime-wsl-export-${buildId}`;
  const tarPath = join(outputDir, `.${buildId}.tar`);
  const outputPath = join(
    outputDir,
    runtimeRootfsFileName(architecture, runtimeVersion),
  );
  const compressedPath = `${outputPath}.building-${process.pid}`;

  try {
    await buildDockerImage(
      image,
      architecture,
      runtimeVersion,
      clineSdkVersion,
    );
    await run("docker", ["create", "--name", container, image]);
    await run("docker", ["export", "--output", tarPath, container]);
    await validateRootfs(tarPath, runtimeVersion);
    await compressRootfs(tarPath, compressedPath);
    await replaceArtifact(compressedPath, outputPath);
    console.log(`Built ${outputPath}`);
  } finally {
    await bestEffort("docker", ["rm", "--force", container]);
    await bestEffort("docker", ["image", "rm", image]);
    await rm(compressedPath, { force: true });
    await rm(tarPath, { force: true });
  }
}

async function replaceArtifact(source, destination) {
  if (process.platform === "win32") await rm(destination, { force: true });
  await rename(source, destination);
}

async function buildDockerImage(
  image,
  architecture,
  runtimeVersion,
  clineSdkVersion,
) {
  try {
    await run(
      "docker",
      dockerBuildArgs(image, architecture, runtimeVersion, clineSdkVersion),
    );
  } catch (error) {
    if (architecture === hostArchitecture()) throw error;
    throw new Error(
      `Docker could not execute ${architecture} images. Install Docker binfmt support or build that architecture in CI.`,
      { cause: error },
    );
  }
}

function dockerBuildArgs(image, architecture, runtimeVersion, sdkVersion) {
  return [
    "build",
    "--platform",
    `linux/${architecture}`,
    "--file",
    dockerfile,
    "--tag",
    image,
    "--build-arg",
    `BLAME_RUNTIME_VERSION=${runtimeVersion}`,
    "--build-arg",
    `BLAME_CLINE_SDK_VERSION=${sdkVersion}`,
    "--build-arg",
    `BLAME_NERDCTL_VERSION=${requiredNerdctlVersion()}`,
    "--build-arg",
    `BLAME_NODE_VERSION=${requiredNodeVersion()}`,
    rootDir,
  ];
}

async function validateRootfs(tarPath, runtimeVersion) {
  const marker = (
    await output("tar", ["-xOf", tarPath, "etc/blame-runtime-version"])
  ).trim();
  if (marker !== runtimeVersion) {
    throw new Error(
      `Rootfs runtime marker is ${marker || "missing"}, expected ${runtimeVersion}.`,
    );
  }
  await output("tar", ["-xOf", tarPath, "usr/local/bin/blame-runtime-agent"]);
}

async function compressRootfs(tarPath, outputPath) {
  const gzip = createGzip({
    level: 6,
  });
  await pipeline(
    createReadStream(tarPath),
    gzip,
    createWriteStream(outputPath),
  );
}

async function deployRootfs() {
  const files = await runtimeFiles();
  if (!files.length)
    throw new Error(`No runtime rootfs files found in ${outputDir}`);

  const runtimeVersion = requiredRuntimeVersion();
  const relativeTarget = `runtime/v${runtimeVersion}/windows`;
  await createDownloadObjectStorage().uploadVersioned(files, relativeTarget);
  await writeRuntimeEnv(files, runtimeVersion);
}

async function runtimeFiles() {
  const runtimeVersion = requiredRuntimeVersion();
  const expectedFiles = new Set(
    architectures.map((architecture) =>
      runtimeRootfsFileName(architecture, runtimeVersion),
    ),
  );
  const entries = await readdir(outputDir);
  return entries
    .filter((entry) => expectedFiles.has(entry))
    .map((entry) => join(outputDir, entry));
}

async function writeRuntimeEnv(files, runtimeVersion) {
  const baseUrl = rootfsPublicBaseUrl(runtimeVersion);
  if (!baseUrl)
    throw new Error(
      "BLAME_RUNTIME_BASE_URL or BLAME_DOWNLOAD_BASE_URL is required",
    );

  const values = [["BLAME_RUNTIME_VERSION", runtimeVersion]];
  for (const file of files) {
    const architecture = architectureFromFile(file);
    if (!architecture) continue;
    const name = architecture.toUpperCase();
    values.push([
      `BLAME_RUNTIME_ROOTFS_${name}_URL`,
      `${baseUrl}/${runtimeRootfsFileName(architecture, runtimeVersion)}`,
    ]);
    values.push([
      `BLAME_RUNTIME_ROOTFS_${name}_SHA256`,
      await sha256File(file),
    ]);
  }
  await upsertEnvValues(envFile, values);
}

function selectedArchitectures() {
  if (args.includes("--all-architectures")) return architectures;
  const explicit = valueArg("--arch");
  const selected = explicit
    ? explicit
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [hostArchitecture()];
  for (const architecture of selected) {
    if (!architectures.includes(architecture))
      throw new Error(`Unsupported WSL architecture: ${architecture}`);
  }
  return selected;
}

function hostArchitecture() {
  return process.arch === "arm64" ? "arm64" : "amd64";
}

function requiredRuntimeVersion() {
  return requiredEnv("BLAME_RUNTIME_VERSION");
}

function requiredNerdctlVersion() {
  return text(process.env.BLAME_NERDCTL_VERSION) ?? "2.1.6";
}

function requiredNodeVersion() {
  return text(process.env.BLAME_NODE_VERSION) ?? "22.23.1";
}

function valueArg(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function architectureFromFile(file) {
  return file.match(/blame-runtime-wsl-(amd64|arm64)-v/)?.[1];
}

async function assertExecutableExists(executable, message) {
  const separator = process.platform === "win32" ? ";" : ":";
  const candidates = (process.env.PATH ?? "")
    .split(separator)
    .filter(Boolean)
    .map((entry) => join(entry, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return;
    } catch {
      continue;
    }
  }
  throw new Error(message);
}

async function bestEffort(commandName, commandArgs) {
  try {
    await run(commandName, commandArgs, { stdio: "ignore" });
  } catch {
    return;
  }
}

function run(commandName, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(commandName, commandArgs, {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === "win32",
      stdio: options.stdio ?? "inherit",
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

function output(commandName, commandArgs) {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(commandName, commandArgs, {
      cwd: rootDir,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectOutput);
    child.once("exit", (code) => {
      if (code === 0) resolveOutput(stdout);
      else
        rejectOutput(
          new Error(
            `${commandName} ${commandArgs.join(" ")} exited with ${code}: ${stderr}`,
          ),
        );
    });
  });
}

function printHelp() {
  console.log(
    "Usage: node scripts/windows-runtime-rootfs.mjs <build|deploy|release> [--arch amd64,arm64] [--all-architectures]",
  );
}
