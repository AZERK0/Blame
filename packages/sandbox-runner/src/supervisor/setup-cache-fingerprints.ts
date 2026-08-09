import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fingerprintFileName = ".blame-setup-fingerprints.json";

export async function setupCacheFingerprintMatches(
  mountpoints: string[],
  taskId: string,
  fingerprint: string,
) {
  if (!mountpoints.length) return true;
  const fingerprints = await Promise.all(
    mountpoints.map((mountpoint) => readFingerprints(mountpoint)),
  );
  return fingerprints.every((entries) => entries[taskId] === fingerprint);
}

export async function writeSetupCacheFingerprint(
  mountpoints: string[],
  taskId: string,
  fingerprint: string,
) {
  for (const mountpoint of mountpoints) {
    const entries = await readFingerprints(mountpoint);
    entries[taskId] = fingerprint;
    await writeFile(
      join(mountpoint, fingerprintFileName),
      JSON.stringify(entries),
      { mode: 0o600, flush: true },
    );
  }
}

async function readFingerprints(mountpoint: string) {
  try {
    const parsed = JSON.parse(
      await readFile(join(mountpoint, fingerprintFileName), "utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as Record<string, string>;
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {} as Record<string, string>;
  }
}
