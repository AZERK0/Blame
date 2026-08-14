import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";
import { stableJson } from "./change-store.js";
import { parseStoredRun, type StoredRun } from "./schemas.js";

type StoredRunContent = Omit<StoredRun, "run_ref" | "content_hash">;

export class RunStore {
  private readonly runsDirectory: string;
  private readonly idempotencyDirectory: string;
  private readonly proposalLinksDirectory: string;
  private readonly lockDirectory: string;

  constructor(workspaceRoot: string) {
    const root = join(workspaceRoot, ".blame", "harness");
    this.runsDirectory = join(root, "runs");
    this.idempotencyDirectory = join(root, "run-idempotency");
    this.proposalLinksDirectory = join(root, "run-proposal-links");
    this.lockDirectory = join(root, "run-locks");
  }

  async write(content: StoredRunContent) {
    const placeholderHash = "0".repeat(64);
    const normalized = withoutIdentity(
      parseStoredRun({
        ...content,
        content_hash: placeholderHash,
        run_ref: `run://${placeholderHash}`,
      }),
    );
    const contentHash = sha256(stableJson(normalized));
    const run = parseStoredRun({
      ...normalized,
      content_hash: contentHash,
      run_ref: `run://${contentHash}`,
    });
    await mkdir(this.runsDirectory, { recursive: true, mode: 0o700 });
    const path = join(this.runsDirectory, `${contentHash}.json`);
    try {
      await writeFile(path, JSON.stringify(run), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const concurrent = await this.read(run.run_ref);
      if (concurrent.content_hash !== run.content_hash)
        throw new Error("Concurrent run record does not match its content.");
      return concurrent;
    }
    if (run.idempotency_key)
      await this.writeIdempotency(
        run.idempotency_key,
        run.input_digest,
        run.run_ref,
      );
    if (run.filesystem_effects.change_proposal_ref)
      await this.linkProposal(
        run.filesystem_effects.change_proposal_ref,
        run.run_ref,
      );
    return run;
  }

  async read(ref: string) {
    const hash = runHash(ref);
    const run = parseStoredRun(
      JSON.parse(
        await readFile(join(this.runsDirectory, `${hash}.json`), "utf8"),
      ),
    );
    if (
      run.run_ref !== ref ||
      run.content_hash !== hash ||
      sha256(stableJson(withoutIdentity(run))) !== hash
    )
      throw new Error("Run record integrity verification failed.");
    return run;
  }

  async readByIdempotency(key: string, inputDigest: string) {
    try {
      const record = JSON.parse(
        await readFile(
          join(this.idempotencyDirectory, `${sha256(key)}.json`),
          "utf8",
        ),
      ) as { input_digest?: string; run_ref?: string };
      if (record.input_digest !== inputDigest)
        throw new Error("Idempotency key is already bound to another run.");
      if (!record.run_ref)
        throw new Error("Run idempotency record is invalid.");
      return this.read(record.run_ref);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async runsForProposal(proposalRef: string) {
    try {
      const refs = JSON.parse(
        await readFile(
          join(this.proposalLinksDirectory, `${sha256(proposalRef)}.json`),
          "utf8",
        ),
      ) as string[];
      return Promise.all(refs.slice(0, 20).map((ref) => this.read(ref)));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
  }

  async exclusiveIdempotency<T>(key: string, operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const target = join(this.lockDirectory, `idempotency-${sha256(key)}`);
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

  private async writeIdempotency(
    key: string,
    inputDigest: string,
    runRef: string,
  ) {
    await mkdir(this.idempotencyDirectory, {
      recursive: true,
      mode: 0o700,
    });
    const path = join(this.idempotencyDirectory, `${sha256(key)}.json`);
    const content = JSON.stringify({
      input_digest: inputDigest,
      run_ref: runRef,
    });
    try {
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(path, "utf8")) as {
        input_digest?: string;
        run_ref?: string;
      };
      if (existing.input_digest !== inputDigest || existing.run_ref !== runRef)
        throw new Error("Run idempotency key is already bound.");
    }
  }

  private async linkProposal(proposalRef: string, runRef: string) {
    await mkdir(this.proposalLinksDirectory, {
      recursive: true,
      mode: 0o700,
    });
    const path = join(
      this.proposalLinksDirectory,
      `${sha256(proposalRef)}.json`,
    );
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const target = join(this.lockDirectory, `proposal-${sha256(proposalRef)}`);
    await mkdir(target, { recursive: true, mode: 0o700 });
    const release = await lock(target, {
      realpath: false,
      retries: { retries: 20, factor: 1.2, minTimeout: 25, maxTimeout: 500 },
      stale: 30_000,
      update: 10_000,
    });
    try {
      let current: string[] = [];
      try {
        current = JSON.parse(await readFile(path, "utf8")) as string[];
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
      const next = [...new Set([...current, runRef])].slice(-20);
      await writeFileAtomic(path, JSON.stringify(next), {
        fsync: true,
        mode: 0o600,
      });
    } finally {
      await release();
    }
  }
}

function withoutIdentity(run: StoredRun): StoredRunContent {
  const { run_ref, content_hash, ...content } = run;
  void run_ref;
  void content_hash;
  return content;
}

function runHash(ref: string) {
  const hash = ref.startsWith("run://") ? ref.slice(6) : "";
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid run ref.");
  return hash;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
