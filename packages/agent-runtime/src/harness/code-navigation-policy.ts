export const fullRawReadMaximumBytes = 8 * 1024;
export const fullRawReadMaximumLines = 120;
export const broadReadCoverageRatio = 0.8;
export const maximumSemanticParseBytes = 2 * 1024 * 1024;
export const autoNarrowedPreviewMaximumBytes = 2 * 1024;
export const autoNarrowedOutlineMaximumItems = 40;
export const autoNarrowedMaximumOutputTokens = 1_800;
export const outlineMaximumOutputTokens = 2_000;
export const outlineMaximumItems = 80;
export const maximumParallelBroadReads = 2;

export type ByteRange = [number, number];

export type RawReadRequest = {
  path: string;
  range?: ByteRange;
};

export type RawReadProfile = {
  broad: boolean;
  coverageRatio?: number;
  estimatedBytes: number;
  fileBytes?: number;
  lineCount?: number;
  requestedRange?: ByteRange;
};

export type WorkspacePathProfile = {
  directory: boolean;
  size: number;
};

export function rawReadProfile(
  content: Buffer,
  requestedRange?: ByteRange,
): RawReadProfile {
  const range = normalizedRange(content.byteLength, requestedRange);
  const selection = content.subarray(range[0], range[1]);
  const lineCount = textLineCount(selection);
  const fileLineCount =
    content.byteLength <= fullRawReadMaximumBytes
      ? textLineCount(content)
      : undefined;
  return readProfile({
    fileBytes: content.byteLength,
    lineCount,
    range,
    fileBroad: Boolean(
      content.byteLength > fullRawReadMaximumBytes ||
      (fileLineCount && fileLineCount > fullRawReadMaximumLines),
    ),
  });
}

export function rawReadSizeProfile(
  size: number,
  requestedRange?: ByteRange,
): RawReadProfile {
  return readProfile({
    fileBytes: size,
    range: normalizedRange(size, requestedRange),
    fileBroad: size > fullRawReadMaximumBytes,
  });
}

export function rawReadLineProfile(
  profile: RawReadProfile,
  selection: Buffer,
): RawReadProfile {
  const lineCount = textLineCount(selection);
  return {
    ...profile,
    broad: profile.broad || lineCount > fullRawReadMaximumLines,
    lineCount,
  };
}

export function searchReadProfile(input: unknown): RawReadProfile | undefined {
  const value = recordValue(input);
  const scope = recordValue(value.scope);
  const paths = stringArray(scope.paths);
  const maximumResults = numberValue(value.max_results) ?? 30;
  const outputTokens = outputTokenBudget(value, 2_000);
  const broad =
    paths.length === 0 ||
    paths.length > 4 ||
    maximumResults > 30 ||
    outputTokens > 2_000;
  if (!broad) return undefined;
  return { broad, estimatedBytes: outputTokens * 4 };
}

export function outlineReadProfile(
  input: unknown,
  path: WorkspacePathProfile,
): RawReadProfile | undefined {
  const value = recordValue(input);
  const budget = recordValue(value.budget);
  const outputTokens = numberValue(budget.max_output_tokens) ?? 3_000;
  const maximumItems = numberValue(budget.max_items) ?? 80;
  const broad =
    path.directory ||
    path.size > fullRawReadMaximumBytes ||
    outputTokens > 3_000 ||
    maximumItems > 80;
  if (!broad) return undefined;
  return {
    broad,
    estimatedBytes: Math.max(path.size, outputTokens * 4),
    fileBytes: path.directory ? undefined : path.size,
  };
}

export function relationReadProfile(
  input: unknown,
): RawReadProfile | undefined {
  const value = recordValue(input);
  const paths = stringArray(recordValue(value.scope).paths);
  const maximumResults = numberValue(value.max_results) ?? 30;
  const outputTokens = outputTokenBudget(value, 1_800);
  const broad =
    paths.length === 0 ||
    paths.length > 4 ||
    maximumResults > 30 ||
    outputTokens > 1_800;
  return broad ? { broad, estimatedBytes: outputTokens * 4 } : undefined;
}

export function rawReadRequest(input: unknown): RawReadRequest | undefined {
  const value = recordValue(input);
  const target = recordValue(value.target);
  const path = stringValue(target.path);
  if (value.view !== "raw" || !path) return undefined;
  const range = byteRange(value.range_utf8_bytes);
  return { path, ...(range ? { range } : {}) };
}

export function textLineCount(content: Buffer) {
  if (!content.length) return 0;
  let lines = 1;
  for (const byte of content) {
    if (byte === 10) lines += 1;
  }
  return lines;
}

function readProfile(input: {
  fileBroad: boolean;
  fileBytes: number;
  lineCount?: number;
  range: ByteRange;
}): RawReadProfile {
  const estimatedBytes = input.range[1] - input.range[0];
  const coverageRatio = input.fileBytes ? estimatedBytes / input.fileBytes : 0;
  return {
    broad:
      estimatedBytes > fullRawReadMaximumBytes ||
      (input.lineCount ?? 0) > fullRawReadMaximumLines ||
      (input.fileBroad && coverageRatio >= broadReadCoverageRatio),
    coverageRatio,
    estimatedBytes,
    fileBytes: input.fileBytes,
    lineCount: input.lineCount,
    requestedRange: input.range,
  };
}

function normalizedRange(size: number, range?: ByteRange): ByteRange {
  if (!range) return [0, size];
  const start = Math.min(size, range[0]);
  return [start, Math.max(start, Math.min(size, range[1]))];
}

function outputTokenBudget(value: Record<string, unknown>, fallback: number) {
  return numberValue(recordValue(value.budget).max_output_tokens) ?? fallback;
}

function byteRange(value: unknown): ByteRange | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const start = numberValue(value[0]);
  const end = numberValue(value[1]);
  return start !== undefined && end !== undefined ? [start, end] : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
