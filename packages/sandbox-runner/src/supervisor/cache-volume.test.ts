import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureCacheVolume,
  resolveCacheVolumeMountpoint,
} from "./cache-volume.js";

test("accepts a cache volume when a restored data root is symlinked", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "blame-cache-volume-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const physicalDataRoot = join(directory, "restored-docker");
  const physicalMountpoint = join(
    physicalDataRoot,
    "volumes",
    "blame-preview_cache-pnpm",
    "_data",
  );
  await mkdir(physicalMountpoint, { recursive: true });
  const logicalDataRoot = join(directory, "docker");
  await symlink(physicalDataRoot, logicalDataRoot, "dir");

  assert.equal(
    await resolveCacheVolumeMountpoint(
      "blame-preview_cache-pnpm",
      join(logicalDataRoot, "volumes", "blame-preview_cache-pnpm", "_data"),
      join(logicalDataRoot, "volumes"),
    ),
    await realpath(physicalMountpoint),
  );
});

test("rejects a cache volume outside Docker's canonical volume root", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "blame-cache-volume-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const volumeRoot = join(directory, "docker", "volumes");
  const outsideMountpoint = join(
    directory,
    "docker",
    "volumes-other",
    "cache",
    "_data",
  );
  await Promise.all([
    mkdir(volumeRoot, { recursive: true }),
    mkdir(outsideMountpoint, { recursive: true }),
  ]);

  await assert.rejects(
    resolveCacheVolumeMountpoint("cache", outsideMountpoint, volumeRoot),
    (error: unknown) =>
      (error as { runnerCode?: string }).runnerCode ===
        "INVALID_CACHE_VOLUME" &&
      (error as Error).message.includes(outsideMountpoint),
  );
});

test("recreates an invalid restored cache volume once", async () => {
  const operations: string[] = [];
  let inspections = 0;
  const mountpoint = await ensureCacheVolume("cache", {
    create: async (name) => {
      operations.push(`create:${name}`);
    },
    remove: async (name) => {
      operations.push(`remove:${name}`);
    },
    mountpoint: async (name) => {
      operations.push(`inspect:${name}`);
      inspections += 1;
      if (inspections === 1) {
        throw Object.assign(new Error("invalid"), {
          runnerCode: "INVALID_CACHE_VOLUME",
        });
      }
      return "/docker/volumes/cache/_data";
    },
  });

  assert.equal(mountpoint, "/docker/volumes/cache/_data");
  assert.deepEqual(operations, [
    "create:cache",
    "inspect:cache",
    "remove:cache",
    "create:cache",
    "inspect:cache",
  ]);
});

test("does not delete a cache volume after an unrelated Docker failure", async () => {
  const operations: string[] = [];
  await assert.rejects(
    ensureCacheVolume("cache", {
      create: async () => {
        operations.push("create");
      },
      remove: async () => {
        operations.push("remove");
      },
      mountpoint: async () => {
        operations.push("inspect");
        throw Object.assign(new Error("daemon unavailable"), {
          runnerCode: "COMPOSE_COMMAND_FAILED",
        });
      },
    }),
    /daemon unavailable/,
  );
  assert.deepEqual(operations, ["create", "inspect"]);
});
