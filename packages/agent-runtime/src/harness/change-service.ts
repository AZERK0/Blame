import { ArtifactStore } from "./artifact-store.js";
import {
  currentFileHash,
  validateProposalWriteTargets,
  verifyProposalBase,
  writeProposedFile,
} from "./change-commit.js";
import {
  fileDiff,
  parseDiagnostic,
  prepareChanges,
  type ChangeFormatting,
  type PreparedFile,
} from "./change-preparation.js";
import { ChangeStore, errorCode, stableJson } from "./change-store.js";
import { sha256 } from "./protocol.js";
import {
  commitJournalSchema,
  commitProposalInputSchema,
  commitReceiptSchema,
  directApplyChangeInputSchema,
  parseStoredChangeProposal,
  proposeChangeInputSchema,
  type CommitProposalInput,
  type CommitReceipt,
  type DirectApplyChangeInput,
  type ProposedFile,
  type ProposeChangeInput,
} from "./schemas.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";

export type {
  ApplyChangeInput,
  ChangeOperation,
  CommitProposalInput,
  CommitReceipt,
  DirectApplyChangeInput,
  ProposeChangeInput,
  StoredChangeProposal,
} from "./schemas.js";

const maximumProposalBytes = 10 * 1024 * 1024;

export class ChangeService {
  private readonly artifacts: ArtifactStore;
  private readonly files: WorkspaceFiles;
  private readonly store: ChangeStore;

  constructor(files: WorkspaceFiles, artifacts: ArtifactStore) {
    this.files = files;
    this.artifacts = artifacts;
    this.store = new ChangeStore(files.root);
  }

  async propose(input: ProposeChangeInput, snapshot: WorkspaceSnapshot) {
    proposeChangeInputSchema.parse(input);
    if (snapshot.revision.source_revision_id !== input.base_source_revision_id)
      throw staleRevision(snapshot.revision.source_revision_id);
    const inputDigest = sha256(stableJson(input));
    const existing = await this.existingProposal(
      input.idempotency_key,
      inputDigest,
    );
    if (existing) return existing;
    const prepared = await prepareChanges(this.files, input);
    return this.persistPreparedProposal({
      baseSourceRevisionId: input.base_source_revision_id,
      idempotencyKey: input.idempotency_key,
      inputDigest,
      preparedFiles: prepared.changes,
      formatting: prepared.formatting,
      maximumTouched: input.policies?.max_touched_files ?? 20,
      enforceParse: input.checks?.includes("parse") ?? false,
    });
  }

  async apply(input: DirectApplyChangeInput) {
    directApplyChangeInputSchema.parse(input);
    const proposalInput = directProposalInput(input);
    const inputDigest = sha256(stableJson(proposalInput));
    const existing = await this.existingProposal(
      proposalInput.idempotency_key,
      inputDigest,
    );
    const proposal =
      existing ??
      (await this.propose(proposalInput, await this.files.snapshot()));
    const priorReceipt = await this.store.readReceipt(proposal.proposal_ref);
    const receipt =
      priorReceipt ??
      (await this.commit({
        action: "commit_proposal",
        proposal_ref: proposal.proposal_ref,
        expected_base_source_revision_id: input.base_source_revision_id,
        idempotency_key: directKey("commit", input.idempotency_key),
      }));
    return { proposal, receipt };
  }

  async proposeRunEffects(input: {
    base_source_revision_id: string;
    idempotency_key: string;
    input_digest: string;
    changes: PreparedFile[];
  }) {
    const existing = await this.existingProposal(
      input.idempotency_key,
      input.input_digest,
    );
    if (existing) return existing;
    return this.persistPreparedProposal({
      baseSourceRevisionId: input.base_source_revision_id,
      idempotencyKey: input.idempotency_key,
      inputDigest: input.input_digest,
      preparedFiles: input.changes,
      formatting: {
        policy: "none",
        formatted_files: [],
        skipped_files: [],
      },
      maximumTouched: 50,
      enforceParse: false,
    });
  }

  private async persistPreparedProposal(input: {
    baseSourceRevisionId: string;
    idempotencyKey: string;
    inputDigest: string;
    preparedFiles: PreparedFile[];
    formatting: ChangeFormatting;
    maximumTouched: number;
    enforceParse: boolean;
  }) {
    const { preparedFiles } = input;
    if (preparedFiles.length > input.maximumTouched)
      throw new Error(
        `Proposal touches ${preparedFiles.length} files; maximum is ${input.maximumTouched}.`,
      );
    const proposalBytes = preparedFiles.reduce(
      (total, change) =>
        total +
        (change.oldContent?.byteLength ?? 0) +
        (change.newContent?.byteLength ?? 0),
      0,
    );
    if (proposalBytes > maximumProposalBytes)
      throw new Error("Proposal content exceeds the 10 MiB safety limit.");
    const diagnostics = preparedFiles.map(parseDiagnostic);
    if (
      input.enforceParse &&
      diagnostics.some((item) => item.after_errors > item.before_errors)
    )
      throw new Error(
        "Parse check failed: the proposal introduces syntax errors.",
      );
    const fullDiff = preparedFiles.map(fileDiff).join("\n");
    const subjectRevision = {
      source_revision_id: input.baseSourceRevisionId,
    };
    const diffArtifact = await this.artifacts.put(
      fullDiff,
      "text/x-diff",
      "1.0",
      "agent_redacted",
      subjectRevision,
    );
    const changes = await Promise.all(
      preparedFiles.map(
        async (change): Promise<ProposedFile> => ({
          path: change.path,
          old_artifact: change.oldContent
            ? await this.artifacts.put(
                change.oldContent,
                "application/octet-stream",
                "1.0",
                "sealed_raw",
                subjectRevision,
              )
            : null,
          new_artifact: change.newContent
            ? await this.artifacts.put(
                change.newContent,
                "application/octet-stream",
                "1.0",
                "sealed_raw",
                subjectRevision,
              )
            : null,
          old_hash: change.oldHash,
          new_hash: change.newHash,
          old_mode: change.oldMode,
          new_mode: change.newMode,
          binary: change.binary,
        }),
      ),
    );
    const summary = diffSummary(fullDiff, 12_000);
    const storedContent = {
      schema_version: "1.1" as const,
      base_source_revision_id: input.baseSourceRevisionId,
      idempotency_key: input.idempotencyKey,
      input_digest: input.inputDigest,
      created_at: new Date().toISOString(),
      changes,
      diff_artifact: diffArtifact,
      diff_summary: summary.content,
      diff_summary_truncated: summary.truncated,
      diff_summary_bytes: summary.bytes,
      diff_bytes: summary.totalBytes,
      diagnostics,
      formatting: input.formatting,
    };
    const contentHash = sha256(stableJson(storedContent));
    const proposalRef = `change-proposal://${contentHash}`;
    const proposal = parseStoredChangeProposal({
      ...storedContent,
      proposal_ref: proposalRef,
      content_hash: contentHash,
    });
    try {
      await this.store.writeProposal(contentHash, proposal);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const concurrent = await this.store.readProposal(proposalRef);
      if (concurrent.input_digest !== input.inputDigest)
        throw new Error("Concurrent proposal content does not match input.");
    }
    const idempotencyHash = sha256(input.idempotencyKey);
    try {
      await this.store.writeIdempotency(idempotencyHash, {
        schema_version: "1.0",
        input_digest: input.inputDigest,
        proposal_ref: proposalRef,
      });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const concurrent = await this.store.readIdempotency(idempotencyHash);
      if (concurrent.input_digest !== input.inputDigest)
        throw new Error(
          "Idempotency key is already bound to another proposal.",
        );
      return this.store.readProposal(concurrent.proposal_ref);
    }
    return proposal;
  }

  private async existingProposal(idempotencyKey: string, inputDigest: string) {
    const idempotencyHash = sha256(idempotencyKey);
    const existing = await this.store.readOptionalIdempotency(idempotencyHash);
    if (!existing) return undefined;
    if (existing.input_digest !== inputDigest)
      throw new Error("Idempotency key is already bound to another proposal.");
    return this.store.readProposal(existing.proposal_ref);
  }

  commit(input: CommitProposalInput): Promise<CommitReceipt> {
    return this.store.exclusive(async () => {
      commitProposalInputSchema.parse(input);
      await this.recoverIncompleteCommit();
      const proposal = await this.store.readProposal(input.proposal_ref);
      if (
        proposal.base_source_revision_id !==
        input.expected_base_source_revision_id
      )
        throw new Error("Proposal base does not match expected base revision.");
      const receipt = await this.store.readReceipt(input.proposal_ref);
      const snapshot = await this.files.snapshot();
      if (receipt) {
        if (receipt.idempotency_key !== input.idempotency_key)
          throw new Error(
            "Commit idempotency key does not match the prior commit.",
          );
        if (
          stableJson(receipt.changed_files) !==
          stableJson(proposal.changes.map((change) => change.path))
        )
          throw new Error("Commit receipt does not match its proposal.");
        if (
          receipt.source_revision.source_revision_id !==
          snapshot.revision.source_revision_id
        )
          throw staleRevision(snapshot.revision.source_revision_id);
        return receipt;
      }
      if (
        snapshot.revision.source_revision_id !==
        input.expected_base_source_revision_id
      )
        throw staleRevision(snapshot.revision.source_revision_id);
      await verifyProposalBase(this.files, proposal);
      await validateProposalWriteTargets(this.files, this.artifacts, proposal);
      const journal = commitJournalSchema.parse({
        schema_version: "1.0",
        proposal_ref: proposal.proposal_ref,
        expected_base_source_revision_id:
          input.expected_base_source_revision_id,
        idempotency_key: input.idempotency_key,
        changed_files: proposal.changes.map((change) => change.path),
        created_at: new Date().toISOString(),
      });
      await this.store.writeJournal(journal);
      const attempted: ProposedFile[] = [];
      let receiptValue: CommitReceipt | undefined;
      try {
        for (const change of proposal.changes) {
          attempted.push(change);
          await writeProposedFile(
            this.files,
            this.artifacts,
            change,
            "new_artifact",
          );
        }
        const sourceRevision = (await this.files.snapshot()).revision;
        receiptValue = commitReceiptSchema.parse({
          schema_version: "1.1",
          change_set_ref: `changeset://${sha256(
            `${input.proposal_ref}\0${sourceRevision.source_revision_id}`,
          )}`,
          proposal_ref: input.proposal_ref,
          idempotency_key: input.idempotency_key,
          source_revision: sourceRevision,
          changed_files: proposal.changes.map((change) => change.path),
        });
        await this.store.writeReceipt(input.proposal_ref, receiptValue);
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const change of attempted.reverse()) {
          try {
            await writeProposedFile(
              this.files,
              this.artifacts,
              change,
              "old_artifact",
            );
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length)
          throw new AggregateError(
            [error, ...rollbackErrors],
            "Commit failed and rollback was incomplete; recovery journal retained.",
          );
        await this.store.removeJournal();
        throw error;
      }
      await this.store.removeJournal().catch(() => undefined);
      return receiptValue;
    });
  }

  readProposal(ref: string) {
    return this.store.readProposal(ref);
  }

  readReceipt(ref: string) {
    return this.store.readReceipt(ref);
  }

  async proposalFileContents(change: ProposedFile) {
    return {
      before: change.old_artifact
        ? await this.artifacts.get(change.old_artifact.ref)
        : undefined,
      after: change.new_artifact
        ? await this.artifacts.get(change.new_artifact.ref)
        : undefined,
    };
  }

  private async recoverIncompleteCommit() {
    const journal = await this.store.readJournal();
    if (!journal) return;
    const proposal = await this.store.readProposal(journal.proposal_ref);
    const receipt = await this.store.readReceipt(journal.proposal_ref);
    if (receipt) {
      if (
        receipt.idempotency_key !== journal.idempotency_key ||
        stableJson(receipt.changed_files) !==
          stableJson(proposal.changes.map((change) => change.path))
      )
        throw new Error("Completed commit receipt does not match its journal.");
      await this.store.removeJournal();
      return;
    }
    const proposalFiles = proposal.changes.map((change) => change.path);
    if (
      journal.expected_base_source_revision_id !==
        proposal.base_source_revision_id ||
      stableJson(journal.changed_files) !== stableJson(proposalFiles)
    )
      throw new Error("Incomplete commit journal does not match its proposal.");
    const states = await Promise.all(
      proposal.changes.map(async (change) => ({
        change,
        state: await currentFileHash(this.files, change.path),
      })),
    );
    for (const { change, state } of states) {
      if (state !== change.old_hash && state !== change.new_hash)
        throw new Error(
          `Incomplete commit recovery found an unexpected state for ${change.path}.`,
        );
    }
    for (const { change, state } of states.reverse()) {
      if (state === change.new_hash)
        await writeProposedFile(
          this.files,
          this.artifacts,
          change,
          "old_artifact",
        );
    }
    await this.store.removeJournal();
  }
}

function directProposalInput(
  input: DirectApplyChangeInput,
): ProposeChangeInput {
  return {
    action: "propose",
    base_source_revision_id: input.base_source_revision_id,
    idempotency_key: directKey("proposal", input.idempotency_key),
    operations: input.operations,
    ...(input.policies ? { policies: input.policies } : {}),
    ...(input.checks ? { checks: input.checks } : {}),
  };
}

function directKey(stage: "commit" | "proposal", key: string) {
  return `apply-${stage}:${sha256(key)}`;
}

function staleRevision(current: string) {
  return new Error(`STALE_REVISION:${current}`);
}

function diffSummary(value: string, maximumBytes: number) {
  const content = Buffer.from(value);
  if (content.byteLength <= maximumBytes)
    return {
      content: value,
      bytes: content.byteLength,
      totalBytes: content.byteLength,
      truncated: false,
    };
  let end = maximumBytes;
  while (end > 0 && (content[end]! & 0xc0) === 0x80) end -= 1;
  return {
    content: content.subarray(0, end).toString("utf8"),
    bytes: end,
    totalBytes: content.byteLength,
    truncated: true,
  };
}
