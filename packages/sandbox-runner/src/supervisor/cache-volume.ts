import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { runnerError } from "../protocol/runner-server.js";

export type CacheVolumeOperations = {
  create(volumeName: string): Promise<void>;
  remove(volumeName: string): Promise<void>;
  mountpoint(volumeName: string): Promise<string>;
};

export async function ensureCacheVolume(
  volumeName: string,
  operations: CacheVolumeOperations,
) {
  await operations.create(volumeName);
  try {
    return await operations.mountpoint(volumeName);
  } catch (error) {
    if (runnerErrorCode(error) !== "INVALID_CACHE_VOLUME") throw error;
  }

  await operations.remove(volumeName);
  await operations.create(volumeName);
  return operations.mountpoint(volumeName);
}

export async function resolveCacheVolumeMountpoint(
  volumeName: string,
  reportedMountpoint: string,
  dockerVolumeRoot: string,
) {
  let mountpoint: string;
  let canonicalVolumeRoot: string;
  try {
    [mountpoint, canonicalVolumeRoot] = await Promise.all([
      realpath(reportedMountpoint),
      realpath(dockerVolumeRoot),
    ]);
  } catch {
    throw invalidCacheVolumeError(
      volumeName,
      reportedMountpoint || "<empty>",
      dockerVolumeRoot,
    );
  }

  const relativeMountpoint = relative(canonicalVolumeRoot, mountpoint);
  const parts = relativeMountpoint.split(sep);
  if (
    isAbsolute(relativeMountpoint) ||
    parts.length !== 2 ||
    !parts[0] ||
    parts[0] === "." ||
    parts[0] === ".." ||
    parts[1] !== "_data"
  ) {
    throw invalidCacheVolumeError(volumeName, mountpoint, canonicalVolumeRoot);
  }
  return mountpoint;
}

function invalidCacheVolumeError(
  volumeName: string,
  mountpoint: string,
  expectedRoot: string,
) {
  return runnerError(
    "INVALID_CACHE_VOLUME",
    `Docker cache volume "${volumeName}" returned mountpoint "${mountpoint}"; expected a direct child of "${expectedRoot}" ending in "/_data".`,
  );
}

function runnerErrorCode(error: unknown) {
  const code = (error as { runnerCode?: unknown })?.runnerCode;
  return typeof code === "string" ? code : undefined;
}
