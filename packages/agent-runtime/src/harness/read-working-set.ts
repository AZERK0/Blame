import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";

type ByteRange = [number, number];

export type ReadReceipt = {
  content_in_active_context: boolean;
  context_epoch: string;
  covered_ranges: ByteRange[];
  path: string;
  read_receipt_ref: string;
  source_blob: string;
  target_ref?: string;
  view: string;
};

type WorkingSetFile = {
  receipts: ReadReceipt[];
  schema_version: "2.0";
};

type RegisterReadInput = {
  contextEpoch?: string;
  deduplicateByBytes?: boolean;
  maximumBytes: number;
  path: string;
  range: ByteRange;
  sourceContent: Buffer;
  sourceBlob: string;
  targetRef?: string;
  view: string;
};

export class ReadWorkingSet {
  private readonly path: string;
  private readonly lockDirectory: string;

  constructor(workspaceRoot: string, sessionId = "unscoped-session") {
    const root = join(workspaceRoot, ".blame", "harness");
    const sessionHash = sha256(sessionId);
    this.path = join(root, "working-sets", `${sessionHash}.json`);
    this.lockDirectory = join(root, "working-set-locks", sessionHash);
  }

  register(input: RegisterReadInput) {
    return this.exclusive(() => this.registerExclusive(input));
  }

  activateEpoch(contextEpoch: string) {
    return this.exclusive(async () => {
      const stored = await this.read();
      let changed = false;
      stored.receipts = stored.receipts.map((receipt) => {
        const active = receipt.context_epoch === contextEpoch;
        if (active === receipt.content_in_active_context) return receipt;
        changed = true;
        return { ...receipt, content_in_active_context: active };
      });
      if (changed) await this.write(stored);
    });
  }

  list() {
    return this.exclusive(async () => (await this.read()).receipts);
  }

  private async registerExclusive(input: RegisterReadInput) {
    const stored = await this.read();
    const contextEpoch = input.contextEpoch ?? "epoch-0";
    const matching = matchingReceipts(stored.receipts, input, contextEpoch);
    const covered = mergeRanges(
      matching.flatMap((receipt) => receipt.covered_ranges),
    );
    const allUncovered = subtractRange(input.range, covered);
    if (!allUncovered.length && matching.length)
      return availableRegistration(matching.at(-1)!);
    const uncovered = limitedRanges(input, allUncovered);
    const receipt = createReceipt({
      contextEpoch,
      coveredRanges: mergeRanges([...covered, ...uncovered]),
      path: input.path,
      sourceBlob: input.sourceBlob,
      targetRef: input.targetRef,
      view: input.view,
    });
    stored.receipts = replaceReceipts(stored.receipts, matching, receipt);
    await this.write(stored);
    return newRegistration(
      input.range,
      covered,
      allUncovered,
      uncovered,
      receipt,
    );
  }

  private async exclusive<T>(operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const release = await lock(this.lockDirectory, {
      realpath: false,
      retries: { retries: 40, factor: 1.2, minTimeout: 10, maxTimeout: 500 },
      stale: 30_000,
      update: 5_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async read(): Promise<WorkingSetFile> {
    try {
      const value = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as WorkingSetFile;
      if (value.schema_version !== "2.0" || !Array.isArray(value.receipts))
        throw new Error("Working set schema is unsupported.");
      return value;
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return { receipts: [], schema_version: "2.0" };
      throw error;
    }
  }

  private async write(value: WorkingSetFile) {
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.path, JSON.stringify(value), {
      fsync: true,
      mode: 0o600,
    });
  }
}

function matchingReceipts(
  receipts: ReadReceipt[],
  input: RegisterReadInput,
  contextEpoch: string,
) {
  return receipts.filter(
    (receipt) =>
      receipt.context_epoch === contextEpoch &&
      receipt.source_blob === input.sourceBlob &&
      receipt.path === input.path &&
      (input.deduplicateByBytes !== false ||
        (receipt.view === input.view &&
          receipt.target_ref === input.targetRef)) &&
      receipt.content_in_active_context,
  );
}

function availableRegistration(receipt: ReadReceipt) {
  return {
    alreadyAvailable: true as const,
    newRanges: [] as ByteRange[],
    omittedBytes: 0,
    overlapRate: 1,
    receipt,
  };
}

function newRegistration(
  requested: ByteRange,
  covered: ByteRange[],
  allUncovered: ByteRange[],
  returned: ByteRange[],
  receipt: ReadReceipt,
) {
  const requestedBytes = requested[1] - requested[0];
  const uncoveredBytes = rangeBytes(allUncovered);
  const returnedBytes = rangeBytes(returned);
  return {
    alreadyAvailable: false as const,
    newRanges: returned,
    omittedBytes: uncoveredBytes - returnedBytes,
    overlapRate:
      requestedBytes > 0
        ? 1 - uncoveredBytes / requestedBytes
        : Number(Boolean(covered.length)),
    receipt,
  };
}

function limitedRanges(input: RegisterReadInput, ranges: ByteRange[]) {
  const selected: ByteRange[] = [];
  let remaining = input.maximumBytes;
  for (const [start, end] of ranges) {
    if (remaining <= 0) break;
    const limitedEnd = Math.min(end, start + remaining);
    const safeEnd = utf8RangeEnd(input.sourceContent, start, limitedEnd);
    if (safeEnd <= start) break;
    selected.push([start, safeEnd]);
    remaining -= safeEnd - start;
    if (safeEnd < end) break;
  }
  return selected;
}

function utf8RangeEnd(content: Buffer, start: number, maximumEnd: number) {
  let end = maximumEnd;
  while (end > start && (content[end]! & 0xc0) === 0x80) end -= 1;
  return end;
}

function rangeBytes(ranges: ByteRange[]) {
  return ranges.reduce((total, [start, end]) => total + end - start, 0);
}

function replaceReceipts(
  receipts: ReadReceipt[],
  matching: ReadReceipt[],
  replacement: ReadReceipt,
) {
  const replaced = new Set(
    matching.map(({ read_receipt_ref }) => read_receipt_ref),
  );
  return [
    ...receipts.filter((receipt) => !replaced.has(receipt.read_receipt_ref)),
    replacement,
  ].slice(-1_000);
}

function createReceipt(input: {
  contextEpoch: string;
  coveredRanges: ByteRange[];
  path: string;
  sourceBlob: string;
  targetRef?: string;
  view: string;
}): ReadReceipt {
  const identity = JSON.stringify(input);
  return {
    context_epoch: input.contextEpoch,
    source_blob: input.sourceBlob,
    path: input.path,
    ...(input.targetRef ? { target_ref: input.targetRef } : {}),
    view: input.view,
    covered_ranges: input.coveredRanges,
    content_in_active_context: true,
    read_receipt_ref: `read-receipt://${sha256(identity)}`,
  };
}

function subtractRange(requested: ByteRange, covered: ByteRange[]) {
  let remaining: ByteRange[] = [requested];
  for (const coverage of covered) {
    remaining = remaining.flatMap((range) => subtractOne(range, coverage));
  }
  return remaining.filter(([start, end]) => end > start);
}

function subtractOne(range: ByteRange, coverage: ByteRange): ByteRange[] {
  if (coverage[1] <= range[0] || coverage[0] >= range[1]) return [range];
  const result: ByteRange[] = [];
  if (coverage[0] > range[0]) result.push([range[0], coverage[0]]);
  if (coverage[1] < range[1]) result.push([coverage[1], range[1]]);
  return result;
}

function mergeRanges(ranges: ByteRange[]) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged: ByteRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range[0] > previous[1]) {
      merged.push([...range]);
      continue;
    }
    previous[1] = Math.max(previous[1], range[1]);
  }
  return merged;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
