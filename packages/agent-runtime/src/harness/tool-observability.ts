import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isHarnessResult, type CauseKind } from "@blame/harness-core";
import { currentWorkspaceRevisionState } from "./workspace-revisions.js";
import { sha256 } from "./protocol.js";

type ToolObservationInput = {
  durationMs: number;
  error?: unknown;
  input: unknown;
  result?: unknown;
  startedAt: number;
  tool: string;
};

export type HarnessToolObservation = {
  cache_usage: { hit: boolean; kind: string };
  duration: number;
  effect: "changed" | "none" | "observed" | "partial";
  environment_revision_id: string;
  error_signature: string | null;
  evidence_produced: string[];
  environment_repair: boolean;
  input_tokens: number;
  normalized_input_digest: string;
  output_tokens: number;
  result_cause: CauseKind | "none";
  source_revision_id: string;
  started_at: string;
  target: string;
  tool: string;
};

export class HarnessToolObservability {
  private pending = Promise.resolve();
  private readonly path: string;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.path = join(
      workspaceRoot,
      ".blame",
      "harness",
      "observability",
      "tool-calls.jsonl",
    );
  }

  async record(input: ToolObservationInput) {
    try {
      const observation = await this.observation(input);
      this.pending = this.pending
        .catch(() => undefined)
        .then(() => this.append(observation));
      await this.pending.catch(() => undefined);
    } catch {}
  }

  private async observation(
    input: ToolObservationInput,
  ): Promise<HarnessToolObservation> {
    const envelope = resultEnvelope(input.result);
    const revisions = await exactRevisions(
      this.workspaceRoot,
      envelope.sourceRevisionId,
      envelope.environmentRevisionId,
    );
    const failure = resultFailure(envelope.value, input.error);
    return {
      cache_usage: cacheUsage(envelope.value),
      duration: input.durationMs,
      effect: resultEffect(envelope.value),
      environment_revision_id: revisions.environment_revision_id,
      error_signature: failure ? normalizedErrorSignature(failure) : null,
      evidence_produced: evidenceReferences(envelope.value),
      environment_repair: environmentRepair(envelope.value),
      input_tokens: tokenEstimate(input.input),
      normalized_input_digest: sha256(stableJson(input.input)),
      output_tokens: tokenEstimate(input.result),
      result_cause: resultCause(envelope.value, input.error),
      source_revision_id: revisions.source_revision_id,
      started_at: new Date(input.startedAt).toISOString(),
      target: toolTarget(input.input),
      tool: input.tool,
    };
  }

  private async append(observation: HarnessToolObservation) {
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    await appendFile(this.path, `${JSON.stringify(observation)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

async function exactRevisions(
  workspaceRoot: string,
  sourceRevisionId?: string,
  environmentRevisionId?: string,
) {
  if (
    validRevision(sourceRevisionId, "src_") &&
    validRevision(environmentRevisionId, "env_")
  )
    return {
      source_revision_id: sourceRevisionId!,
      environment_revision_id: environmentRevisionId!,
    };
  return currentWorkspaceRevisionState(workspaceRoot);
}

function resultEnvelope(result: unknown) {
  const value = recordValue(result);
  const nested = recordValue(value.output);
  const envelope = Object.keys(nested).length ? nested : value;
  if (isHarnessResult(envelope))
    return {
      value: envelope,
      sourceRevisionId: envelope.source_revision_id,
      environmentRevisionId: envelope.environment_revision_id,
    };
  const revision = recordValue(envelope.subject_revision);
  return {
    value: envelope,
    sourceRevisionId: stringValue(revision.source_revision_id),
    environmentRevisionId: stringValue(revision.environment_spec_revision_id),
  };
}

function resultCause(
  result: unknown,
  error?: unknown,
): HarnessToolObservation["result_cause"] {
  if (error) return "infrastructure_failure";
  const value = recordValue(result);
  if (isHarnessResult(value)) return value.cause ?? "none";
  const data = recordValue(value.data);
  if (data.status === "infrastructure_error") return "infrastructure_failure";
  if (value.status !== "error") return "none";
  return legacyCause(stringValue(recordValue(value.error).code));
}

function resultEffect(result: unknown): HarnessToolObservation["effect"] {
  const value = recordValue(result);
  if (isHarnessResult(value)) return value.effect;
  const data = recordValue(value.data);
  if (value.outcome === "applied" || data.status === "applied")
    return "changed";
  if (["completed", "success"].includes(String(value.outcome)))
    return "observed";
  return "none";
}

function environmentRepair(result: unknown) {
  const value = recordValue(result);
  const repair = recordValue(recordValue(value.data).environment_repair);
  return repair.attempted === true;
}

function legacyCause(code?: string): CauseKind {
  if (code === "INVALID_INPUT") return "invalid_input";
  if (code === "EXECUTION_ERROR") return "infrastructure_failure";
  if (code === "UNSUPPORTED_OPERATION") return "harness_limitation";
  return "code_error";
}

function resultFailure(result: unknown, error?: unknown) {
  if (error) return error instanceof Error ? error.message : String(error);
  const value = recordValue(result);
  if (isHarnessResult(value))
    return value.outcome === "blocked"
      ? `${value.issue.code}:${value.issue.message}`
      : undefined;
  const legacyError = recordValue(value.error);
  return stringValue(legacyError.message) ?? stringValue(value.reason);
}

function normalizedErrorSignature(message: string) {
  const normalized = message
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t\S+/gu, "<timestamp>")
    .replace(/(?:[a-z]:)?[\\/][^\s:]+/giu, "<path>")
    .replace(/\b[a-f0-9]{16,}\b/gu, "<digest>")
    .replace(/\b\d+(?:\.\d+)?\b/gu, "<number>")
    .replace(/\s+/gu, " ")
    .trim();
  return `error://${sha256(normalized).slice(0, 32)}`;
}

function cacheUsage(result: unknown) {
  const value = recordValue(result);
  const data = recordValue(value.data);
  const deduplication = recordValue(data.deduplication);
  if (deduplication.reused === true)
    return { hit: true, kind: "validation_receipt" };
  if (data.cache_hit === true || data.status === "already_available")
    return { hit: true, kind: "read_receipt" };
  return { hit: false, kind: "none" };
}

function evidenceReferences(result: unknown) {
  const value = recordValue(result);
  if (isHarnessResult(value)) return [...value.evidence].slice(0, 20);
  return collectEvidence(value).slice(0, 20);
}

function collectEvidence(value: unknown, key = "", depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string")
    return /(?:evidence|receipt|artifact)_ref$/u.test(key) ? [value] : [];
  if (Array.isArray(value))
    return value.flatMap((item) => collectEvidence(item, key, depth + 1));
  const record = recordValue(value);
  return [
    ...new Set(
      Object.entries(record).flatMap(([entryKey, item]) =>
        collectEvidence(item, entryKey, depth + 1),
      ),
    ),
  ];
}

function toolTarget(input: unknown) {
  const value = recordValue(input);
  const target = recordValue(value.target);
  const task = recordValue(value.task);
  const direct = [value.path, target.path, task.task_id].find(
    (candidate) => typeof candidate === "string",
  );
  if (typeof direct === "string") return direct.slice(0, 240);
  const operations = Array.isArray(value.operations) ? value.operations : [];
  const paths = operations
    .map((operation) => stringValue(recordValue(operation).path))
    .filter((path): path is string => Boolean(path));
  return [...new Set(paths)].slice(0, 5).join(",") || "workspace";
}

function tokenEstimate(value: unknown) {
  return Math.ceil(Buffer.byteLength(stableJson(value), "utf8") / 4);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function validRevision(value: string | undefined, prefix: string) {
  return Boolean(value?.startsWith(prefix) && !value.endsWith("unavailable"));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
