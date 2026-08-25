import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";

type StoredEditReceipt<T> = {
  input_digest: string;
  result: T;
  schema_version: "2.0";
};

export class EditReceiptStore {
  private readonly directory: string;
  private readonly lockDirectory: string;

  constructor(workspaceRoot: string) {
    const root = join(workspaceRoot, ".blame", "harness");
    this.directory = join(root, "edit-receipts");
    this.lockDirectory = join(root, "edit-locks");
  }

  async exclusive<T>(key: string, operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const target = join(this.lockDirectory, sha256(key));
    await mkdir(target, { recursive: true, mode: 0o700 });
    const release = await lock(target, {
      realpath: false,
      retries: { retries: 40, factor: 1.2, minTimeout: 25, maxTimeout: 1_000 },
      stale: 60_000,
      update: 10_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  async read<T>(key: string, inputDigest: string): Promise<T | undefined> {
    try {
      const receipt = JSON.parse(
        await readFile(this.path(key), "utf8"),
      ) as StoredEditReceipt<T>;
      if (receipt.schema_version !== "2.0")
        throw new Error("Edit receipt schema is unsupported.");
      if (receipt.input_digest !== inputDigest)
        throw new Error("Tool call is already bound to another edit input.");
      return receipt.result;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async write<T>(key: string, inputDigest: string, result: T) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFileAtomic(
      this.path(key),
      JSON.stringify({
        input_digest: inputDigest,
        result,
        schema_version: "2.0",
      } satisfies StoredEditReceipt<T>),
      { fsync: true, mode: 0o600 },
    );
    return result;
  }

  private path(key: string) {
    return join(this.directory, `${sha256(key)}.json`);
  }
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
