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
} from "./change-preparation.js";
import { ChangeStore, errorCode, stableJson } from "./change-store.js";
import { sha256 } from "./protocol.js";
import {
  commitJournalSchema,
  commitProposalInputSchema,
  commitReceiptSchema,
  parseStoredChangeProposal,
  proposeChangeInputSchema,
  type ApplyChangeInput,
  type CommitProposalInput,
  type CommitReceipt,
  type ProposedFile,
  type ProposeChangeInput,
} from "./schemas.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";

export type {
  ApplyChangeInput,
  ChangeOperation,
  CommitProposalInput,
  CommitReceipt,
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
    const idempotencyHash = sha256(input.idempotency_key);
    const existingIdempotency =
      await this.store.readOptionalIdempotency(idempotencyHash);
    if (existingIdempotency) {
      if (existingIdempotency.input_digest !== inputDigest)
        throw new Error(
          "Idempotency key is already bound to another proposal.",
        );
      return this.store.readProposal(existingIdempotency.proposal_ref);
    }

    const preparedFiles = await prepareChanges(this.files, input);
    const maximumTouched = input.policies?.max_touched_files ?? 20;
    if (preparedFiles.length > maximumTouched)
      throw new Error(
        `Proposal touches ${preparedFiles.length} files; maximum is ${maximumTouched}.`,
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
      input.checks?.includes("parse") &&
      diagnostics.some((item) => item.after_errors > item.before_errors)
    )
      throw new Error(
        "Parse check failed: the proposal introduces syntax errors.",
      );
    const fullDiff = preparedFiles.map(fileDiff).join("\n");
    const diffArtifact = await this.artifacts.put(fullDiff, "text/x-diff");
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
              )
            : null,
          new_artifact: change.newContent
            ? await this.artifacts.put(
                change.newContent,
                "application/octet-stream",
                "1.0",
                "sealed_raw",
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
    const storedContent = {
      schema_version: "1.1" as const,
      base_source_revision_id: input.base_source_revision_id,
      idempotency_key: input.idempotency_key,
      input_digest: inputDigest,
      created_at: new Date().toISOString(),
      changes,
      diff_artifact: diffArtifact,
      diff_summary: truncate(fullDiff, 12_000),
      diagnostics,
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
      if (concurrent.input_digest !== inputDigest)
        throw new Error("Concurrent proposal content does not match input.");
    }
    try {
      await this.store.writeIdempotency(idempotencyHash, {
        schema_version: "1.0",
        input_digest: inputDigest,
        proposal_ref: proposalRef,
      });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const concurrent = await this.store.readIdempotency(idempotencyHash);
      if (concurrent.input_digest !== inputDigest)
        throw new Error(
          "Idempotency key is already bound to another proposal.",
        );
      return this.store.readProposal(concurrent.proposal_ref);
    }
    return proposal;
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

function staleRevision(current: string) {
  return new Error(`STALE_REVISION:${current}`);
}

function truncate(value: string, maximum: number) {
  return value.length > maximum
    ? `${value.slice(0, maximum)}\n… truncated`
    : value;
}
