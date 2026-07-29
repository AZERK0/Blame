import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDownloadObjectStorage } from "./download-object-storage.mjs";
import { loadEnvFiles } from "./env-files.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = join(rootDir, "packages/desktop");
const distDir = join(desktopDir, "dist");
const requireDesktop = createRequire(join(desktopDir, "package.json"));
const YAML = requireDesktop("yaml");
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

await loadEnvFiles(rootDir);

if (command === "build") await build(args);
else if (command === "deploy") await deploy();
else if (command === "stage") await stage();
else if (command === "deploy-staged") await deployStaged();
else if (command === "cleanup-staged") await cleanupStaged();
else if (command === "release") {
  await build(args);
  await deploy();
} else {
  printHelp();
  process.exit(command === "help" ? 0 : 1);
}

async function build(platformArgs) {
  const packageArgs = platformArgs.length ? platformArgs : ["--linux", "--x64"];
  await run("pnpm", ["--filter", "@blame/desktop", "build"], rootDir);
  if (isDualArchitectureMacosBuild(packageArgs)) {
    await buildMacosArchitectures(packageArgs);
    return;
  }
  await packageDesktop(packageArgs);
}

async function packageDesktop(packageArgs) {
  await run(
    "pnpm",
    [
      "--filter",
      "@blame/desktop",
      "package",
      "--",
      ...packageArgs,
      "--publish",
      "never",
    ],
    rootDir,
  );
}

async function buildMacosArchitectures(packageArgs) {
  const commonArgs = packageArgs.filter(
    (argument) => argument !== "--x64" && argument !== "--arm64",
  );
  const firstDist = await mkdtemp(join(tmpdir(), "blame-desktop-x64-"));

  try {
    await packageDesktop([...commonArgs, "--x64"]);
    await cp(distDir, firstDist, {
      recursive: true,
      verbatimSymlinks: true,
    });
    const x64Update = await readMacosUpdateMetadata(firstDist);

    await packageDesktop([...commonArgs, "--arm64"]);
    const arm64Update = await readMacosUpdateMetadata(distDir);
    await restoreUniqueReleaseFiles(firstDist);
    await writeMacosUpdateMetadata(mergeMacosUpdates(x64Update, arm64Update));
  } finally {
    await rm(firstDist, { force: true, recursive: true });
  }
}

function isDualArchitectureMacosBuild(packageArgs) {
  return (
    packageArgs.some(
      (argument) => argument === "--mac" || argument === "mac",
    ) &&
    packageArgs.includes("--x64") &&
    packageArgs.includes("--arm64")
  );
}

async function readMacosUpdateMetadata(directory) {
  return YAML.parse(await readFile(join(directory, "latest-mac.yml"), "utf8"));
}

async function restoreUniqueReleaseFiles(sourceDirectory) {
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "latest-mac.yml") continue;
    const destination = join(distDir, entry.name);
    try {
      await readFile(destination);
    } catch {
      await cp(join(sourceDirectory, entry.name), destination);
    }
  }
}

function mergeMacosUpdates(x64Update, arm64Update) {
  const files = new Map();
  for (const file of [
    ...(x64Update.files ?? []),
    ...(arm64Update.files ?? []),
  ]) {
    files.set(file.url, file);
  }
  return {
    ...x64Update,
    files: [...files.values()],
    releaseDate: arm64Update.releaseDate ?? x64Update.releaseDate,
  };
}

async function writeMacosUpdateMetadata(metadata) {
  await writeFile(
    join(distDir, "latest-mac.yml"),
    YAML.stringify(metadata),
    "utf8",
  );
}

async function deploy() {
  const sourceDirectory = releaseSourceDirectory();
  const stagingDirectory = await mkdtemp(
    join(tmpdir(), "blame-desktop-release-"),
  );

  try {
    const findFiles = args.includes("--source")
      ? recursiveReleaseFiles
      : directReleaseFiles;
    const files = await releaseFiles(
      sourceDirectory,
      stagingDirectory,
      findFiles,
    );
    if (!files.length) {
      throw new Error(`No release files found in ${sourceDirectory}`);
    }
    const storage = createDownloadObjectStorage();
    const pruneLatest = args.includes("--prune-latest");
    if (pruneLatest) assertCompleteRelease(files);
    await storage.publishLatest(files, { prune: pruneLatest });
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}

async function stage() {
  const sourceDirectory = releaseSourceDirectory();
  const stagingDirectory = await mkdtemp(
    join(tmpdir(), "blame-desktop-stage-"),
  );

  try {
    const files = await releaseFiles(
      sourceDirectory,
      stagingDirectory,
      directReleaseFiles,
    );
    if (!files.length) {
      throw new Error(`No release files found in ${sourceDirectory}`);
    }
    await createDownloadObjectStorage().uploadStaged(
      files,
      requiredOption("--prefix"),
    );
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
}

async function deployStaged() {
  const storage = createDownloadObjectStorage();
  await storage.publishStagedLatest(requiredOption("--prefix"), {
    mergeMetadata: mergeStagedMetadata,
    prune: args.includes("--prune-latest"),
    validate: assertCompleteReleaseNames,
  });
}

async function cleanupStaged() {
  await createDownloadObjectStorage().deletePrefix(requiredOption("--prefix"));
}

async function releaseFiles(
  directory,
  stagingDirectory,
  findFiles = recursiveReleaseFiles,
) {
  const files = await findFiles(directory);
  const grouped = Map.groupBy(files, (file) => file.name);
  const resolved = [];
  for (const [name, matches] of grouped) {
    if (matches.length === 1) {
      resolved.push(matches[0].path);
      continue;
    }
    if (name !== "latest-mac.yml") {
      throw new Error(`Duplicate release file: ${name}`);
    }
    resolved.push(await mergeMacosMetadata(matches, stagingDirectory));
  }
  return resolved;
}

async function directReleaseFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (!entry.isFile() || !isReleaseFile(entry.name)) return [];
    return [{ name: entry.name, path: join(directory, entry.name) }];
  });
}

async function recursiveReleaseFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await recursiveReleaseFiles(path)));
    else if (entry.isFile() && isReleaseFile(entry.name)) {
      files.push({ name: entry.name, path });
    }
  }
  return files;
}

async function mergeMacosMetadata(files, stagingDirectory) {
  const metadata = await Promise.all(
    files.map(async ({ path }) => YAML.parse(await readFile(path, "utf8"))),
  );
  const merged = metadata.slice(1).reduce(mergeMacosUpdates, metadata[0]);
  const destination = join(stagingDirectory, "latest-mac.yml");
  await writeFile(destination, YAML.stringify(merged), "utf8");
  return destination;
}

function isReleaseFile(file) {
  if (file.startsWith("latest") && file.endsWith(".yml")) return true;
  if (file.endsWith(".blockmap")) return true;
  return [".AppImage", ".deb", ".dmg", ".exe", ".rpm", ".zip"].includes(
    extname(file),
  );
}

function assertCompleteRelease(files) {
  assertCompleteReleaseNames(files.map((file) => basename(file)));
}

function assertCompleteReleaseNames(names) {
  const fileNames = new Set(names);
  const requiredMetadata = ["latest.yml", "latest-mac.yml", "latest-linux.yml"];
  const missing = requiredMetadata.filter((name) => !fileNames.has(name));
  if (missing.length) {
    throw new Error(`Cannot prune latest without ${missing.join(", ")}`);
  }
}

function mergeStagedMetadata(name, values) {
  if (name !== "latest-mac.yml") {
    throw new Error(`Duplicate staged release metadata: ${name}`);
  }
  const metadata = values.map((value) => YAML.parse(value));
  const merged = metadata.slice(1).reduce(mergeMacosUpdates, metadata[0]);
  return YAML.stringify(merged);
}

function releaseSourceDirectory() {
  const sourceIndex = args.indexOf("--source");
  const source = sourceIndex < 0 ? undefined : args[sourceIndex + 1];
  return source ? resolve(rootDir, source) : distDir;
}

function requiredOption(name) {
  const optionIndex = args.indexOf(name);
  const value = optionIndex < 0 ? undefined : args[optionIndex + 1]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(`${command} ${args.join(" ")} exited with ${code}`),
        );
    });
  });
}

function printHelp() {
  console.log(
    "Usage: node scripts/desktop-release.mjs <build|deploy|stage|deploy-staged|cleanup-staged|release> [--source path] [--prefix path] [--prune-latest] [electron-builder args]",
  );
}
