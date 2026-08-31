import {
  RetryLedger,
  type HarnessResult,
  type RecoveryCondition,
  type RetryIdentity,
} from "@blame/harness-core";
import type { SemanticWorkspaceToolName } from "./semantic-executor.js";
import { WorkspaceFiles } from "./workspace-files.js";
import { WorkspaceStateAuthority } from "./workspace-revisions.js";

export type RetrySuppression = {
  recovery: RecoveryCondition;
  sourceRevisionId?: string;
};

type RecordedAttempt = {
  identity: RetryIdentity;
  recovery: RecoveryCondition;
};

export class RecoveryController {
  private readonly attempts = new Map<string, RecordedAttempt>();
  private readonly authority: WorkspaceStateAuthority;
  private readonly ledger = new RetryLedger();

  constructor(files: WorkspaceFiles) {
    this.authority = new WorkspaceStateAuthority(files);
  }

  async before(
    tool: SemanticWorkspaceToolName,
    input: unknown,
  ): Promise<RetrySuppression | undefined> {
    const key = requestKey(tool, input);
    const prior = this.attempts.get(key);
    if (!prior) return undefined;
    const identity = await this.currentIdentity(prior);
    if (this.ledger.canAttempt(identity)) return undefined;
    return {
      recovery: prior.recovery,
      ...(identity.source_revision_id
        ? { sourceRevisionId: identity.source_revision_id }
        : {}),
    };
  }

  observe(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessResult<unknown, unknown>,
  ) {
    const key = requestKey(tool, input);
    const prior = this.attempts.get(key);
    if (result.outcome !== "blocked") {
      if (prior) this.ledger.clear(prior.identity);
      this.attempts.delete(key);
      return;
    }
    const identity = retryIdentity(tool, input, result);
    if (prior) this.ledger.clear(prior.identity);
    this.ledger.remember(identity, result.recovery);
    this.attempts.set(key, { identity, recovery: result.recovery });
  }

  currentRevisions() {
    return this.authority.current();
  }

  private async currentIdentity(prior: RecordedAttempt) {
    const current = await this.authority.current();
    return {
      ...prior.identity,
      source_revision_id: current.source_revision_id,
      environment_revision_id: current.environment_revision_id,
    };
  }
}

function retryIdentity(
  tool: SemanticWorkspaceToolName,
  input: unknown,
  result: HarnessResult<unknown, unknown>,
): RetryIdentity {
  return {
    tool,
    normalized_input: input,
    source_revision_id: result.provenance.source_revision_id,
    environment_revision_id: result.provenance.environment_revision_id,
    policy_version: "canonical-result/v4",
  };
}

function requestKey(tool: string, input: unknown) {
  return `${tool}:${stableJson(input)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(",")}}`;
}
