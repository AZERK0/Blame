import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";

type DependencyCapabilityCircuitState = {
  environment_fingerprint: string;
  opened_at: string;
  reason: string;
};

export class DependencyCapabilityCircuit {
  private readonly lockDirectory: string;
  private readonly path: string;

  constructor(workspaceRoot: string, sessionId: string) {
    const root = join(workspaceRoot, ".blame", "harness", "capabilities");
    const identity = sha256(sessionId);
    this.path = join(root, `${identity}.json`);
    this.lockDirectory = join(root, `${identity}.lock`);
  }

  status(environmentFingerprint: string) {
    return this.exclusive(async () => {
      const state = await this.read();
      if (!state) return undefined;
      if (state.environment_fingerprint === environmentFingerprint)
        return state;
      await this.write(undefined);
      return undefined;
    });
  }

  open(environmentFingerprint: string, reason: string) {
    return this.exclusive(() =>
      this.write({
        environment_fingerprint: environmentFingerprint,
        opened_at: new Date().toISOString(),
        reason: normalizeReason(reason),
      }),
    );
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const release = await lock(this.lockDirectory, {
      realpath: false,
      retries: { retries: 40, factor: 1.2, minTimeout: 10, maxTimeout: 500 },
      stale: 30_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async read(): Promise<DependencyCapabilityCircuitState | undefined> {
    try {
      const value = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as DependencyCapabilityCircuitState | null;
      return value ?? undefined;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  private async write(state: DependencyCapabilityCircuitState | undefined) {
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.path, JSON.stringify(state ?? null), {
      fsync: true,
      mode: 0o600,
    });
  }
}

function normalizeReason(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 1_000);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
