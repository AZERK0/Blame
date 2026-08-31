import {
  RetryLedger,
  type HarnessResult,
  type RecoveryCondition,
  type RetryIdentity,
} from "@blame/harness-core";
import type { AgentToolContext } from "@cline/sdk";
import { statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { sha256 } from "./protocol.js";
import type { SemanticWorkspaceToolName } from "./semantic-executor.js";
import { WorkspaceFiles } from "./workspace-files.js";

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
  private readonly files: WorkspaceFiles;
  private readonly ledger = new RetryLedger();

  constructor(files: WorkspaceFiles) {
    this.files = files;
  }

  async before(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    context: AgentToolContext,
  ): Promise<RetrySuppression | undefined> {
    const key = requestKey(tool, input);
    const prior = this.attempts.get(key);
    if (!prior) return undefined;
    const identity = await this.currentIdentity(prior, context);
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
    context: AgentToolContext,
    result: HarnessResult<unknown, unknown>,
  ) {
    const key = requestKey(tool, input);
    const prior = this.attempts.get(key);
    if (result.outcome !== "blocked") {
      if (prior) this.ledger.clear(prior.identity);
      this.attempts.delete(key);
      return;
    }
    const identity = retryIdentity(
      tool,
      input,
      context,
      this.files.root,
      result,
    );
    if (prior) this.ledger.clear(prior.identity);
    this.ledger.remember(identity, result.recovery);
    this.attempts.set(key, { identity, recovery: result.recovery });
  }

  environmentFingerprint(context: AgentToolContext) {
    return environmentFingerprint(this.files.root, context);
  }

  private async currentIdentity(
    prior: RecordedAttempt,
    context: AgentToolContext,
  ) {
    const sourceRevisionId = await currentSourceRevision(this.files, prior);
    const identity: RetryIdentity = {
      ...prior.identity,
      environment_revision_id: environmentRevisionId(
        this.environmentFingerprint(context),
      ),
    };
    if (sourceRevisionId) identity.source_revision_id = sourceRevisionId;
    return identity;
  }
}

async function currentSourceRevision(
  files: WorkspaceFiles,
  prior: RecordedAttempt,
) {
  if (prior.recovery.condition !== "new_source_revision")
    return prior.identity.source_revision_id;
  return (await files.snapshot()).revision.source_revision_id;
}

function retryIdentity(
  tool: SemanticWorkspaceToolName,
  input: unknown,
  context: AgentToolContext,
  workspaceRoot: string,
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

function environmentRevisionId(fingerprint: string) {
  return `env_${sha256(fingerprint).slice(0, 32)}`;
}

function environmentFingerprint(
  workspaceRoot: string,
  context: AgentToolContext,
) {
  return sha256(
    stableJson({
      architecture: process.arch,
      execution: context.runId ?? context.sessionId ?? context.conversationId,
      node: process.versions.node,
      observables: runtimeObservables(workspaceRoot),
      platform: process.platform,
      workspace: resolve(workspaceRoot),
    }),
  );
}

function runtimeObservables(workspaceRoot: string) {
  return [
    ...workspaceRuntimePaths(workspaceRoot),
    ...runtimeExecutablePaths(),
  ].map(observablePathState);
}

function workspaceRuntimePaths(workspaceRoot: string) {
  return [
    "node_modules",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    join(".blame", "harness", "capabilities"),
  ].map((path) => join(workspaceRoot, path));
}

function runtimeExecutablePaths() {
  const names = new Set(["bwrap", "node", "npm", "pnpm", "yarn"]);
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((directory) =>
      [...names].flatMap((name) =>
        extensions.map((extension) => join(directory, `${name}${extension}`)),
      ),
    );
}

function observablePathState(path: string) {
  try {
    const state = statSync(path);
    return [path, state.mtimeMs, state.size, state.mode];
  } catch {
    return [path, "missing"];
  }
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
