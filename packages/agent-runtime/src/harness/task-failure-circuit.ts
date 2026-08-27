import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";

type CircuitState = {
  count: number;
  message: string;
  signature: string;
  updated_at: string;
};

export class TaskFailureCircuit {
  private readonly lockDirectory: string;
  private readonly path: string;

  constructor(workspaceRoot: string, sessionId: string) {
    const root = join(workspaceRoot, ".blame", "harness", "task-failures");
    const identity = sha256(sessionId);
    this.path = join(root, `${identity}.json`);
    this.lockDirectory = join(root, `${identity}.lock`);
  }

  blocked() {
    return this.exclusive(async () => {
      const state = await this.read();
      return state && state.count >= 3 ? state : undefined;
    });
  }

  recordFailure(message: string) {
    return this.exclusive(async () => {
      const current = await this.read();
      const normalized = normalizedFailure(message);
      const signature = sha256(normalized);
      const count = current?.signature === signature ? current.count + 1 : 1;
      await this.write({
        count,
        message: normalized.slice(0, 1_000),
        signature,
        updated_at: new Date().toISOString(),
      });
    });
  }

  reset() {
    return this.exclusive(async () => {
      await this.write(undefined);
    });
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

  private async read(): Promise<CircuitState | undefined> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as CircuitState;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  private async write(state: CircuitState | undefined) {
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.path, JSON.stringify(state ?? null), {
      fsync: true,
      mode: 0o600,
    });
  }
}

function normalizedFailure(message: string) {
  return message
    .replace(/\/tmp\/\.mount_[^/\s]+/giu, "<app-mount>")
    .replace(/[a-f0-9]{32,}/giu, "<digest>")
    .replace(/\s+/gu, " ")
    .trim();
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
