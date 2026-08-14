import { createHash } from "node:crypto";

export const harnessProtocolVersion = "1.0";
export const harnessToolSchemaVersion = "1.0";

export type HarnessErrorCode =
  | "AMBIGUOUS_TARGET"
  | "INVALID_INPUT"
  | "IO_ERROR"
  | "POLICY_DENIED"
  | "PRECONDITION_FAILED"
  | "STALE_REVISION"
  | "TARGET_GONE"
  | "UNSUPPORTED_CAPABILITY"
  | "UNSUPPORTED_STRUCTURE";

export type RevisionVector = {
  source_revision_id?: string;
  index_revision_id?: string;
  environment_spec_revision_id?: string;
  runtime_instance_id?: string;
};

export type SourceRevisionRef = {
  source_revision_id: string;
  base_commit?: string;
  overlay_merkle_root: string;
};

export type FileRef = {
  ref: string;
  source_revision_id: string;
  path: string;
  blob_hash: string;
};

export type SymbolRef = {
  ref: string;
  source_revision_id: string;
  definition_digest: string;
  kind: string;
  language: string;
  qualified_name: string;
};

export type SyntaxNodeRef = {
  ref: string;
  source_revision_id: string;
  file_blob_hash: string;
  range_utf8_bytes: [number, number];
  node_digest: string;
};

export type ArtifactRef = {
  ref: string;
  content_hash: string;
  media_type: string;
  schema_version: string;
  visibility: "agent_redacted" | "reviewer" | "sealed_raw";
};

export type Provenance = {
  producer: "git" | "parser" | "lexical" | "filesystem" | "harness";
  producer_version?: string;
  revision: RevisionVector;
  artifact_hash?: string;
  locations?: string[];
  trust_domain: "workspace" | "tool";
  authority: "data" | "policy";
  observed_at?: string;
};

export type Coverage = {
  scope: "complete" | "partial" | "unknown";
  truncated: boolean;
  analysis:
    | "exact"
    | "sound_overapproximation"
    | "observed_subset"
    | "heuristic";
  continuation?: string;
};

export type HarnessToolSuccess<T> = {
  protocol_version: string;
  tool_schema_version: string;
  status: "success";
  subject_revision: RevisionVector;
  data: T;
  provenance: Provenance[];
  coverage: Coverage;
  usage: { output_tokens: number; elapsed_ms: number };
  artifacts?: ArtifactRef[];
  diagnostics?: unknown[];
};

export type HarnessToolError = {
  protocol_version: string;
  tool_schema_version: string;
  status: "error";
  subject_revision?: RevisionVector;
  error: {
    code: HarnessErrorCode;
    message: string;
    recovery?: unknown;
  };
};

export type HarnessToolResult<T> = HarnessToolSuccess<T> | HarnessToolError;

export type HandlePayload = {
  version: 1;
  revision: string;
  path: string;
  start: number;
  end: number;
  digest: string;
  kind?: string;
  language?: string;
  qualifiedName?: string;
};

export function harnessSuccess<T>(input: {
  data: T;
  revision: RevisionVector;
  startedAt: number;
  provenance: Provenance[];
  coverage?: Partial<Coverage>;
  artifacts?: ArtifactRef[];
  diagnostics?: unknown[];
}): HarnessToolSuccess<T> {
  const result = {
    protocol_version: harnessProtocolVersion,
    tool_schema_version: harnessToolSchemaVersion,
    status: "success" as const,
    subject_revision: input.revision,
    data: input.data,
    provenance: input.provenance,
    coverage: {
      scope: input.coverage?.scope ?? "complete",
      truncated: input.coverage?.truncated ?? false,
      analysis: input.coverage?.analysis ?? "exact",
      ...(input.coverage?.continuation
        ? { continuation: input.coverage.continuation }
        : {}),
    },
    usage: { output_tokens: 0, elapsed_ms: Date.now() - input.startedAt },
    ...(input.artifacts?.length ? { artifacts: input.artifacts } : {}),
    ...(input.diagnostics?.length ? { diagnostics: input.diagnostics } : {}),
  };
  result.usage.output_tokens = estimateOutputTokens(result);
  return result;
}

export function harnessError(input: {
  code: HarnessErrorCode;
  message: string;
  revision?: RevisionVector;
  recovery?: unknown;
}): HarnessToolError {
  return {
    protocol_version: harnessProtocolVersion,
    tool_schema_version: harnessToolSchemaVersion,
    status: "error",
    ...(input.revision ? { subject_revision: input.revision } : {}),
    error: {
      code: input.code,
      message: input.message,
      ...(input.recovery === undefined ? {} : { recovery: input.recovery }),
    },
  };
}

export function provenance(
  producer: Provenance["producer"],
  revision: RevisionVector,
  locations?: string[],
): Provenance {
  return {
    producer,
    revision,
    ...(locations?.length ? { locations } : {}),
    trust_domain: producer === "harness" ? "tool" : "workspace",
    authority: "data",
  };
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function encodeHandle(
  scheme: "file" | "node" | "sym",
  payload: HandlePayload,
) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${scheme}://${encoded}`;
}

export function decodeHandle(
  value: string,
  scheme: "file" | "node" | "sym",
): HandlePayload | undefined {
  if (!value.startsWith(`${scheme}://`)) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(value.slice(scheme.length + 3), "base64url").toString("utf8"),
    ) as Partial<HandlePayload>;
    if (
      payload.version !== 1 ||
      typeof payload.revision !== "string" ||
      !/^src_[a-f0-9]{32}$/.test(payload.revision) ||
      typeof payload.path !== "string" ||
      !payload.path ||
      !Number.isSafeInteger(payload.start) ||
      !Number.isSafeInteger(payload.end) ||
      payload.start! < 0 ||
      payload.end! < payload.start! ||
      typeof payload.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(payload.digest)
    )
      return undefined;
    return payload as HandlePayload;
  } catch {
    return undefined;
  }
}

function estimateOutputTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}
