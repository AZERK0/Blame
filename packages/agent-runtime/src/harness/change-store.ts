import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";
import {
  commitJournalSchema,
  parseCommitReceipt,
  parseStoredChangeProposal,
  proposalIdempotencyRecordSchema,
  type CommitJournal,
  type CommitReceipt,
  type ProposalIdempotencyRecord,
  type StoredChangeProposal,
} from "./schemas.js";

export class ChangeStore {
  private readonly idempotencyDirectory: string;
  private readonly journalsDirectory: string;
  private readonly lockDirectory: string;
  private readonly proposalsDirectory: string;
  private readonly receiptsDirectory: string;

  constructor(workspaceRoot: string) {
    const root = join(workspaceRoot, ".blame", "harness");
    this.idempotencyDirectory = join(root, "idempotency");
    this.journalsDirectory = join(root, "journals");
    this.lockDirectory = join(root, "locks");
    this.proposalsDirectory = join(root, "proposals");
    this.receiptsDirectory = join(root, "commits");
  }

  async readProposal(ref: string) {
    const hash = proposalHash(ref);
    const content = await readFile(
      join(this.proposalsDirectory, `${hash}.json`),
      "utf8",
    );
    const proposal = parseStoredChangeProposal(JSON.parse(content));
    if (proposal.content_hash !== hash || proposal.proposal_ref !== ref)
      throw new Error("Proposal content address does not match its file.");
    if (proposalContentHash(proposal) !== hash)
      throw new Error("Proposal integrity verification failed.");
    return proposal;
  }

  async writeProposal(hash: string, proposal: StoredChangeProposal) {
    await mkdir(this.proposalsDirectory, { recursive: true });
    await writeExclusive(
      join(this.proposalsDirectory, `${hash}.json`),
      JSON.stringify(proposal),
    );
  }

  async readIdempotency(hash: string) {
    const content = await readFile(
      join(this.idempotencyDirectory, `${hash}.json`),
      "utf8",
    );
    return proposalIdempotencyRecordSchema.parse(JSON.parse(content));
  }

  async readOptionalIdempotency(hash: string) {
    try {
      return await this.readIdempotency(hash);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeIdempotency(hash: string, value: ProposalIdempotencyRecord) {
    await mkdir(this.idempotencyDirectory, { recursive: true });
    await writeExclusive(
      join(this.idempotencyDirectory, `${hash}.json`),
      JSON.stringify(proposalIdempotencyRecordSchema.parse(value)),
    );
  }

  async readReceipt(ref: string) {
    try {
      const content = await readFile(
        join(this.receiptsDirectory, `${proposalHash(ref)}.json`),
        "utf8",
      );
      const receipt = parseCommitReceipt(JSON.parse(content));
      if (receipt.proposal_ref !== ref)
        throw new Error("Commit receipt belongs to another proposal.");
      const expectedChangeSet = `changeset://${sha256(
        `${ref}\0${receipt.source_revision.source_revision_id}`,
      )}`;
      if (receipt.change_set_ref !== expectedChangeSet)
        throw new Error("Commit receipt integrity verification failed.");
      return receipt;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeReceipt(ref: string, receipt: CommitReceipt) {
    await mkdir(this.receiptsDirectory, { recursive: true });
    await writeExclusive(
      join(this.receiptsDirectory, `${proposalHash(ref)}.json`),
      JSON.stringify(receipt),
    );
  }

  async readJournal() {
    try {
      return commitJournalSchema.parse(
        JSON.parse(await readFile(this.journalPath(), "utf8")),
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeJournal(journal: CommitJournal) {
    await mkdir(this.journalsDirectory, { recursive: true });
    await writeFileAtomic(this.journalPath(), JSON.stringify(journal), {
      fsync: true,
      mode: 0o600,
    });
  }

  async removeJournal() {
    await rm(this.journalPath(), { force: true });
  }

  async exclusive<T>(operation: () => Promise<T>) {
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });
    const release = await lock(this.lockDirectory, {
      lockfilePath: join(this.lockDirectory, "workspace-write.lock"),
      realpath: false,
      retries: { retries: 20, factor: 1.2, minTimeout: 25, maxTimeout: 500 },
      stale: 30_000,
      update: 10_000,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private journalPath() {
    return join(this.journalsDirectory, "active.json");
  }
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function proposalHash(ref: string) {
  const hash = ref.startsWith("change-proposal://") ? ref.slice(18) : "";
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid proposal ref.");
  return hash;
}

function proposalContentHash(proposal: StoredChangeProposal) {
  return sha256(
    stableJson({
      schema_version: proposal.schema_version,
      base_source_revision_id: proposal.base_source_revision_id,
      idempotency_key: proposal.idempotency_key,
      input_digest: proposal.input_digest,
      created_at: proposal.created_at,
      changes: proposal.changes,
      diff_artifact: proposal.diff_artifact,
      diff_summary: proposal.diff_summary,
      ...(proposal.diff_summary_truncated !== undefined
        ? { diff_summary_truncated: proposal.diff_summary_truncated }
        : {}),
      ...(proposal.diff_summary_bytes !== undefined
        ? { diff_summary_bytes: proposal.diff_summary_bytes }
        : {}),
      ...(proposal.diff_bytes !== undefined
        ? { diff_bytes: proposal.diff_bytes }
        : {}),
      diagnostics: proposal.diagnostics,
      ...(proposal.formatting ? { formatting: proposal.formatting } : {}),
    }),
  );
}

async function writeExclusive(path: string, content: string) {
  await writeFile(path, content, { flag: "wx", mode: 0o600 });
}
