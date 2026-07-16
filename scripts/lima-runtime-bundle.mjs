import { constants as fsConstants, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { sha256File } from "./file-sha256.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(rootDir, ".blame/runtime-tools/lima");

export async function resolveLimaBundle(manifest, platform, architecture) {
  const explicit = process.env.BLAME_LIMA_BUNDLE_DIR?.trim();
  if (explicit) {
    await assertBundle(explicit);
    return resolve(explicit);
  }

  const spec = archiveSpec(manifest, platform, architecture);
  const bundleDir = join(
    cacheRoot,
    manifest.lima.version,
    `${platform}-${architecture}`,
  );
  if (await validCachedBundle(bundleDir, spec.sha256)) return bundleDir;

  await downloadBundle(bundleDir, spec);
  return bundleDir;
}

export async function copyLimaBundle(
  manifest,
  platform,
  architecture,
  destination,
) {
  const bundleDir = await resolveLimaBundle(manifest, platform, architecture);
  await rm(destination, { force: true, recursive: true });
  await cp(bundleDir, destination, { recursive: true });
}

function archiveSpec(manifest, platform, architecture) {
  const spec = manifest.lima?.archives?.[platform]?.[architecture];
  if (!spec?.url || !spec?.sha256) {
    throw new Error(
      `Missing verified Lima archive for ${platform}/${architecture}.`,
    );
  }
  return spec;
}

async function validCachedBundle(bundleDir, expectedSha256) {
  try {
    await assertBundle(bundleDir);
    const checksum = (
      await readFile(join(bundleDir, ".archive-sha256"), "utf8")
    ).trim();
    return checksum === expectedSha256;
  } catch {
    return false;
  }
}

async function downloadBundle(bundleDir, spec) {
  const temporaryDir = `${bundleDir}.download-${process.pid}`;
  const archive = `${temporaryDir}.tar.gz`;
  await rm(temporaryDir, { force: true, recursive: true });
  await rm(archive, { force: true });
  await mkdir(temporaryDir, { recursive: true });

  try {
    await download(spec.url, archive);
    await assertChecksum(archive, spec.sha256);
    await run("tar", ["-xzf", archive, "-C", temporaryDir]);
    await assertBundle(temporaryDir);
    await writeFile(
      join(temporaryDir, ".archive-sha256"),
      `${spec.sha256}\n`,
      "utf8",
    );
    await rm(bundleDir, { force: true, recursive: true });
    await mkdir(dirname(bundleDir), { recursive: true });
    await rename(temporaryDir, bundleDir);
  } finally {
    await rm(temporaryDir, { force: true, recursive: true });
    await rm(archive, { force: true });
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok)
    throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  if (!response.body)
    throw new Error(`Could not read the response from ${url}.`);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );
}

async function assertChecksum(file, expected) {
  const actual = await sha256File(file);
  if (actual !== expected.toLowerCase()) {
    throw new Error(
      `Lima archive checksum mismatch: expected ${expected}, received ${actual}.`,
    );
  }
}

async function assertBundle(bundleDir) {
  await access(join(bundleDir, "bin/limactl"), fsConstants.X_OK);
  await access(join(bundleDir, "bin/lima"), fsConstants.X_OK);
  await access(join(bundleDir, "share/lima"));
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      shell: false,
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
