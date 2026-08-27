import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const harnessProtocolVersion = "2.0";
export const harnessToolSchemaVersion = "2.0";

export type HarnessErrorCode =
  | "AMBIGUOUS_TARGET"
  | "EXECUTION_ERROR"
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
  producer:
    | "compiler"
    | "filesystem"
    | "git"
    | "harness"
    | "lexical"
    | "parser";
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
  version: 1 | 2;
  revision: string;
  path: string;
  start: number;
  end: number;
  digest: string;
  observedBlobHash?: string;
  kind?: string;
  language?: string;
  parentQualifiedName?: string;
  qualifiedName?: string;
  signatureDigest?: string;
  bodyFingerprint?: string;
  ancestryFingerprint?: string;
  neighborFingerprint?: string;
  ordinal?: number;
  matchedText?: string;
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

export function recalculateHarnessUsage<T>(value: T): T {
  if (!value || typeof value !== "object" || !("usage" in value)) return value;
  const current = value as Record<string, unknown>;
  const usage = current.usage;
  if (!usage || typeof usage !== "object" || !("output_tokens" in usage))
    return value;
  const updated = {
    ...current,
    usage: { ...(usage as Record<string, unknown>), output_tokens: 0 },
  };
  (updated.usage as Record<string, unknown>).output_tokens =
    estimateOutputTokens(updated);
  return updated as T;
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

export function boundHarnessResult<T>(
  result: HarnessToolResult<T>,
  maximumTokens?: number,
): HarnessToolResult<unknown> {
  if (!maximumTokens) return result;
  const maximumBytes = maximumTokens * 4;
  if (serializedBytes(result) <= maximumBytes) return result;
  return result.status === "success"
    ? boundSuccess(result, maximumBytes)
    : boundError(result, maximumBytes);
}

function boundSuccess<T>(
  result: HarnessToolSuccess<T>,
  maximumBytes: number,
): HarnessToolSuccess<unknown> {
  const bounded: HarnessToolSuccess<unknown> = {
    ...result,
    data: result.data,
    provenance: result.provenance.map(withoutProvenanceLocations),
    coverage: {
      scope: "partial",
      truncated: true,
      analysis: result.coverage.analysis,
    },
  };
  delete bounded.artifacts;
  delete bounded.diagnostics;
  bounded.data = fitData(
    result.data,
    availableDataBytes(bounded, maximumBytes),
  );
  while (serializedBytes(bounded) > maximumBytes && bounded.provenance.length)
    bounded.provenance.pop();
  if (serializedBytes(bounded) > maximumBytes)
    bounded.data = { truncated: true };
  bounded.usage.output_tokens = estimateOutputTokens(bounded);
  return bounded;
}

function withoutProvenanceLocations(value: Provenance): Provenance {
  const bounded = { ...value };
  delete bounded.locations;
  return bounded;
}

function boundError(result: HarnessToolError, maximumBytes: number) {
  const bounded: HarnessToolError = {
    ...result,
    error: {
      ...result.error,
      message: truncateUtf8(
        result.error.message,
        Math.max(80, maximumBytes / 2),
      ),
      ...(result.error.recovery === undefined
        ? {}
        : { recovery: fitData(result.error.recovery, maximumBytes / 3) }),
    },
  };
  if (serializedBytes(bounded) <= maximumBytes) return bounded;
  delete bounded.error.recovery;
  bounded.error.message = truncateUtf8(
    bounded.error.message,
    Math.max(
      20,
      maximumBytes - serializedBytes(bounded) + bounded.error.message.length,
    ),
  );
  return bounded;
}

function availableDataBytes(
  result: HarnessToolSuccess<unknown>,
  maximumBytes: number,
) {
  return Math.max(
    16,
    maximumBytes - serializedBytes({ ...result, data: null }) - 8,
  );
}

function fitData(value: unknown, maximumBytes: number) {
  const profiles = [
    [50, 4_000, 8],
    [20, 2_000, 6],
    [10, 800, 5],
    [5, 300, 4],
    [3, 100, 3],
  ] as const;
  for (const [maximumEntries, maximumCharacters, maximumDepth] of profiles) {
    const candidate = projectValue(
      value,
      maximumEntries,
      maximumCharacters,
      maximumDepth,
    );
    if (serializedBytes(candidate) <= maximumBytes) return candidate;
  }
  return { truncated: true };
}

function projectValue(
  value: unknown,
  maximumEntries: number,
  maximumCharacters: number,
  maximumDepth: number,
): unknown {
  if (typeof value === "string") return truncateUtf8(value, maximumCharacters);
  if (!value || typeof value !== "object") return value;
  if (maximumDepth <= 0) return "[truncated]";
  if (Array.isArray(value))
    return projectArray(value, maximumEntries, maximumCharacters, maximumDepth);
  return projectRecord(value, maximumEntries, maximumCharacters, maximumDepth);
}

function projectArray(
  value: unknown[],
  maximumEntries: number,
  maximumCharacters: number,
  maximumDepth: number,
) {
  return value
    .slice(0, maximumEntries)
    .map((entry) =>
      projectValue(entry, maximumEntries, maximumCharacters, maximumDepth - 1),
    );
}

function projectRecord(
  value: object,
  maximumEntries: number,
  maximumCharacters: number,
  maximumDepth: number,
) {
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, maximumEntries)
      .map(([key, entry]) => [
        key,
        projectValue(
          entry,
          maximumEntries,
          maximumCharacters,
          maximumDepth - 1,
        ),
      ]),
  );
}

function truncateUtf8(value: string, maximumBytes: number) {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  let end = Math.min(value.length, Math.max(0, Math.floor(maximumBytes / 2)));
  while (
    end > 0 &&
    Buffer.byteLength(`${value.slice(0, end)}…`, "utf8") > maximumBytes
  )
    end -= 1;
  return `${value.slice(0, end)}…`;
}

function serializedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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
  scheme: "file" | "match" | "node" | "sym",
  payload: HandlePayload,
) {
  const values =
    payload.version === 2
      ? [
          payload.version,
          payload.revision,
          payload.path,
          payload.start,
          payload.end,
          payload.digest,
          payload.kind,
          payload.language,
          payload.qualifiedName,
          payload.observedBlobHash,
          payload.signatureDigest,
          payload.bodyFingerprint,
          payload.ancestryFingerprint,
          payload.neighborFingerprint,
          payload.ordinal,
          payload.matchedText,
        ]
      : [
          payload.version,
          payload.revision,
          payload.path,
          payload.start,
          payload.end,
          payload.digest,
          payload.kind,
          payload.language,
          payload.qualifiedName,
        ];
  const encoded = deflateRawSync(Buffer.from(JSON.stringify(values))).toString(
    "base64url",
  );
  return `${scheme}://z${encoded}`;
}

export function decodeHandle(
  value: string,
  scheme: "file" | "match" | "node" | "sym",
): HandlePayload | undefined {
  if (!value.startsWith(`${scheme}://`)) return undefined;
  try {
    const encoded = value.slice(scheme.length + 3);
    const bytes = Buffer.from(
      encoded.startsWith("z") ? encoded.slice(1) : encoded,
      "base64url",
    );
    const decoded = JSON.parse(
      (encoded.startsWith("z") ? inflateRawSync(bytes) : bytes).toString(
        "utf8",
      ),
    ) as Partial<HandlePayload> | unknown[];
    const payload = Array.isArray(decoded)
      ? handlePayloadFromTuple(decoded)
      : decoded;
    if (
      (payload.version !== 1 && payload.version !== 2) ||
      typeof payload.revision !== "string" ||
      !/^src_[a-f0-9]{32}$/.test(payload.revision) ||
      typeof payload.path !== "string" ||
      !payload.path ||
      !Number.isSafeInteger(payload.start) ||
      !Number.isSafeInteger(payload.end) ||
      payload.start! < 0 ||
      payload.end! < payload.start! ||
      typeof payload.digest !== "string" ||
      !(payload.version === 2
        ? /^[a-f0-9]{32,64}$/.test(payload.digest)
        : /^[a-f0-9]{64}$/.test(payload.digest))
    )
      return undefined;
    return payload as HandlePayload;
  } catch {
    return undefined;
  }
}

function handlePayloadFromTuple(value: unknown[]): Partial<HandlePayload> {
  const version = value[0] as 1 | 2;
  return {
    version,
    revision: value[1] as string,
    path: value[2] as string,
    start: value[3] as number,
    end: value[4] as number,
    digest: expandFingerprint(value[5]) as string,
    ...(typeof value[6] === "string" ? { kind: value[6] } : {}),
    ...(typeof value[7] === "string" ? { language: value[7] } : {}),
    ...(typeof value[8] === "string" ? { qualifiedName: value[8] } : {}),
    ...(typeof value[9] === "string"
      ? { observedBlobHash: expandFingerprint(value[9]) }
      : {}),
    ...(version === 1 && typeof value[10] === "string"
      ? { parentQualifiedName: value[10] }
      : {}),
    ...(typeof value[version === 2 ? 10 : 11] === "string"
      ? {
          signatureDigest: expandFingerprint(
            value[version === 2 ? 10 : 11],
          ) as string,
        }
      : {}),
    ...(version === 2 && typeof value[11] === "string"
      ? { bodyFingerprint: expandFingerprint(value[11]) }
      : {}),
    ...(version === 2 && typeof value[12] === "string"
      ? { ancestryFingerprint: expandFingerprint(value[12]) }
      : {}),
    ...(version === 2 && typeof value[13] === "string"
      ? { neighborFingerprint: expandFingerprint(value[13]) }
      : {}),
    ...(version === 2 && Number.isSafeInteger(value[14])
      ? { ordinal: value[14] as number }
      : {}),
    ...(version === 2 && typeof value[15] === "string"
      ? { matchedText: value[15] }
      : {}),
  };
}

function expandFingerprint(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("~")) return value;
  return Buffer.from(value.slice(1), "base64url").toString("hex");
}

function estimateOutputTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}
