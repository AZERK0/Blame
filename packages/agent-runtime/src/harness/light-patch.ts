import { computePatchChanges, PatchActionType } from "@cline/sdk";
import type { PatchFileChange } from "@cline/sdk";
import { diffLines } from "diff";

export type LightPatchReplacement = {
  end: number;
  replacement: string;
  start: number;
};

export type LightPatchPlan =
  | { mode: "add"; content: string }
  | { mode: "delete" }
  | { mode: "update"; replacements: LightPatchReplacement[] };

export type LightPatchOperation = { patch: string; path: string };

type ParsedPatch = {
  headerIndex: number;
  hunks: string[][];
  mode: "add" | "delete" | "update";
  lines: string[];
};

export function splitLightPatch(
  patch: string,
  requestedPath?: string,
): LightPatchOperation[] {
  const lines = normalizedPatchLines(patch, requestedPath);
  assertPatchEnvelope(lines);
  const headers = patchHeaders(lines);
  if (!headers.length) throw new Error("Patch contains no file operation.");
  if (headers.length > 50) throw new Error("Patch contains too many files.");
  assertEmptyPatchPrefix(lines, headers[0]!.index);
  return headers.map((header, index) => {
    const end = headers[index + 1]?.index ?? lines.length - 1;
    const path =
      headers.length === 1 && requestedPath ? requestedPath : header.path;
    const section = [
      "*** Begin Patch",
      ...lines.slice(header.index, end),
      "*** End Patch",
    ];
    return { path, patch: section.join("\n") };
  });
}

function normalizedPatchLines(patch: string, requestedPath?: string) {
  let lines = patch.trimEnd().split(/\r?\n/u);
  if (hasBareFileEnvelope(lines)) lines = ["*** Begin Patch", ...lines];
  if (requestedPath && hasLeadingUpdateHunk(lines)) {
    assertSingleLinePath(requestedPath);
    lines.splice(1, 0, `*** Update File: ${requestedPath}`);
  } else if (requestedPath && hasLeadingAddBody(lines)) {
    assertSingleLinePath(requestedPath);
    lines.splice(1, 0, `*** Add File: ${requestedPath}`);
  }
  return lines;
}

function hasBareFileEnvelope(lines: string[]) {
  return (
    /^\*\*\* (?:Add|Delete|Update) File:\s*.+$/u.test(lines[0] ?? "") &&
    lines.at(-1) === "*** End Patch"
  );
}

function hasLeadingUpdateHunk(lines: string[]) {
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch")
    return false;
  const firstContent = lines.findIndex(
    (line, index) => index > 0 && line.trim().length > 0,
  );
  const firstHeader = patchHeaders(lines)[0]?.index ?? lines.length - 1;
  return (
    firstContent > 0 &&
    firstContent < firstHeader &&
    lines[firstContent]?.startsWith("@@")
  );
}

function hasLeadingAddBody(lines: string[]) {
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch")
    return false;
  const firstHeader = patchHeaders(lines)[0]?.index ?? lines.length - 1;
  const leadingBody = lines.slice(1, firstHeader);
  return (
    leadingBody.length > 0 && leadingBody.every((line) => line.startsWith("+"))
  );
}

function assertSingleLinePath(path: string) {
  if (/[\r\n]/u.test(path)) throw new Error("Patch path must be one line.");
}

export async function planLightPatch(
  workspaceRoot: string,
  path: string,
  source: string | undefined,
  patch: string,
) {
  const parsed = normalizedMissingTargetAddition(
    parseClinePatchShape(patch),
    source,
  );
  assertExactUniqueContexts(source, parsed, path);
  const normalized = normalizedPatch(parsed, path);
  const change = await computeSingleChange(normalized, workspaceRoot);
  return patchPlanFromChange(change, source);
}

function normalizedMissingTargetAddition(
  parsed: ParsedPatch,
  source: string | undefined,
): ParsedPatch {
  if (
    source !== undefined ||
    parsed.mode !== "update" ||
    parsed.hunks.length === 0 ||
    parsed.hunks.some(
      (hunk) => hunk.length === 0 || hunk.some((line) => !line.startsWith("+")),
    )
  )
    return parsed;
  return {
    ...parsed,
    lines: parsed.lines.filter((line) => !line.startsWith("@@")),
    mode: "add",
  };
}

async function computeSingleChange(patch: string, workspaceRoot: string) {
  const computed = await computePatchChanges(patch, workspaceRoot, {
    restrictToCwd: true,
  });
  if (computed.fuzz !== 0) throw new Error("Patch context is not exact.");
  const entries = Object.entries(computed.changes) as Array<
    [string, PatchFileChange]
  >;
  if (entries.length !== 1)
    throw new Error("Each patch operation must contain exactly one file.");
  const change = entries[0]![1];
  if (change.movePath)
    throw new Error("Represent moves as add and delete operations.");
  return change;
}

function patchPlanFromChange(
  change: PatchFileChange,
  source: string | undefined,
): LightPatchPlan {
  if (change.type === PatchActionType.ADD)
    return { mode: "add", content: change.newContent ?? "" };
  if (change.type === PatchActionType.DELETE) return { mode: "delete" };
  if (source === undefined)
    throw new Error("Patch update target does not exist.");
  return {
    mode: "update",
    replacements: changedRanges(source, change.newContent ?? ""),
  };
}

function parseClinePatchShape(patch: string): ParsedPatch {
  const lines = patch.trimEnd().split(/\r?\n/u);
  assertPatchEnvelope(lines);
  const headerIndexes = patchHeaders(lines).map(({ index }) => index);
  if (headerIndexes.length !== 1)
    throw new Error("Each patch operation must contain exactly one file.");
  const headerIndex = headerIndexes[0]!;
  const action = lines[headerIndex]!.match(
    /^\*\*\* (Add|Delete|Update) File:/u,
  )?.[1];
  if (!action) throw new Error("Patch file operation is invalid.");
  return {
    headerIndex,
    hunks: patchHunks(lines.slice(headerIndex + 1, -1)),
    lines,
    mode: action.toLowerCase() as ParsedPatch["mode"],
  };
}

function assertPatchEnvelope(lines: string[]) {
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch")
    throw new Error("Patch must use the Cline Apply Patch format.");
}

function patchHeaders(lines: string[]) {
  return lines.flatMap((line, index) => {
    const match = line.match(/^\*\*\* (?:Add|Delete|Update) File:\s*(.+)$/u);
    const path = match?.[1]?.trim();
    return path ? [{ index, path }] : [];
  });
}

function assertEmptyPatchPrefix(lines: string[], firstHeader: number) {
  const prefix = lines.slice(1, firstHeader);
  if (prefix.some((line) => line.trim()))
    throw new Error("Patch contains content before its first file operation.");
}

function patchHunks(lines: string[]) {
  const hunks: string[][] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      current = [];
      hunks.push(current);
      continue;
    }
    if (line === "*** End of File") continue;
    if (!current) {
      current = [];
      hunks.push(current);
    }
    current.push(line);
  }
  return hunks;
}

function assertExactUniqueContexts(
  source: string | undefined,
  parsed: ParsedPatch,
  path: string,
) {
  if (parsed.mode !== "update") return;
  if (source === undefined)
    throw new Error("Patch update target does not exist.");
  for (const hunk of parsed.hunks) {
    const context = selectedLines(hunk, new Set([" ", "-"]));
    if (!context) throw new Error("Update hunks require exact context.");
    const matches = lineBoundedMatches(source, context);
    if (matches.length !== 1)
      throw new Error(patchContextFailure(path, source, context, matches));
  }
}

function patchContextFailure(
  path: string,
  source: string,
  expected: string,
  matches: number[],
) {
  if (matches.length) {
    const lines = matches.map((offset) => lineNumberAt(source, offset));
    return `Patch context is ambiguous in ${path} at lines ${lines.join(", ")}.`;
  }
  const closest = closestCurrentContext(source, expected);
  return [
    `Patch context does not match in ${path}.`,
    `Closest current lines ${closest.startLine}-${closest.endLine}:`,
    closest.content,
  ].join("\n");
}

function closestCurrentContext(source: string, expected: string) {
  const sourceLines = source.split(/\r?\n/u);
  const expectedLines = expected
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .sort((left, right) => right.trim().length - left.trim().length)
    .slice(0, 8);
  const index = closestLineIndex(sourceLines, expectedLines);
  const start = Math.max(0, index - 2);
  const end = Math.min(sourceLines.length, index + 3);
  return {
    content: sourceLines.slice(start, end).join("\n").slice(0, 2_000),
    startLine: start + 1,
    endLine: end,
  };
}

function closestLineIndex(source: string[], expected: string[]) {
  let bestIndex = 0;
  let bestScore = -1;
  source.forEach((candidate, index) => {
    const score = Math.max(
      0,
      ...expected.map((line) => lineSimilarity(candidate, line)),
    );
    if (score <= bestScore) return;
    bestIndex = index;
    bestScore = score;
  });
  return bestIndex;
}

function lineSimilarity(left: string, right: string) {
  const candidate = left.trim().slice(0, 500);
  const expected = right.trim().slice(0, 500);
  if (!candidate || !expected) return 0;
  const containment =
    Math.min(candidate.length, expected.length) >= 12 &&
    (candidate.includes(expected) || expected.includes(candidate))
      ? 1_000
      : 0;
  const words = new Set(expected.match(/[\p{L}\p{N}_$]+/gu) ?? []);
  const overlap = (candidate.match(/[\p{L}\p{N}_$]+/gu) ?? []).filter((word) =>
    words.has(word),
  ).length;
  return containment + commonPrefixLength(candidate, expected) * 4 + overlap * 20;
}

function commonPrefixLength(left: string, right: string) {
  const maximum = Math.min(left.length, right.length);
  let index = 0;
  while (index < maximum && left[index] === right[index]) index += 1;
  return index;
}

function lineNumberAt(source: string, offset: number) {
  return source.slice(0, offset).split("\n").length;
}

function normalizedPatch(parsed: ParsedPatch, path: string) {
  const lines = [...parsed.lines];
  const label = `${parsed.mode[0]!.toUpperCase()}${parsed.mode.slice(1)}`;
  lines[parsed.headerIndex] = `*** ${label} File: ${path}`;
  return lines.join("\n");
}

function changedRanges(before: string, after: string) {
  const replacements: Array<{
    end: number;
    replacement: string;
    start: number;
  }> = [];
  let cursor = 0;
  let pending: { end: number; replacement: string; start: number } | undefined;
  for (const part of diffLines(before, after)) {
    if (!part.added && !part.removed) {
      if (pending) replacements.push(minimalReplacement(before, pending));
      pending = undefined;
      cursor += part.value.length;
      continue;
    }
    pending ??= { start: cursor, end: cursor, replacement: "" };
    if (part.removed) {
      cursor += part.value.length;
      pending.end = cursor;
    } else pending.replacement += part.value;
  }
  if (pending) replacements.push(minimalReplacement(before, pending));
  return mergeWhitespaceSeparated(before, replacements).map((replacement) =>
    byteReplacement(before, replacement),
  );
}

function minimalReplacement(
  source: string,
  replacement: { end: number; replacement: string; start: number },
) {
  let { end, replacement: value, start } = replacement;
  while (start < end && value) {
    const sourceCharacter = characterAt(source, start);
    const replacementCharacter = characterAt(value, 0);
    if (sourceCharacter !== replacementCharacter) break;
    start += sourceCharacter.length;
    value = value.slice(replacementCharacter.length);
  }
  while (start < end && value) {
    const sourceCharacter = characterBefore(source, end);
    const replacementCharacter = characterBefore(value, value.length);
    if (sourceCharacter.value !== replacementCharacter.value) break;
    end = sourceCharacter.start;
    value = value.slice(0, replacementCharacter.start);
  }
  return { end, replacement: value, start };
}

function characterAt(value: string, offset: number) {
  return String.fromCodePoint(value.codePointAt(offset)!);
}

function characterBefore(value: string, end: number) {
  const low = value.charCodeAt(end - 1);
  const high = value.charCodeAt(end - 2);
  const paired =
    low >= 0xdc00 &&
    low <= 0xdfff &&
    high >= 0xd800 &&
    high <= 0xdbff;
  const start = paired ? end - 2 : end - 1;
  return { start, value: value.slice(start, end) };
}

function mergeWhitespaceSeparated(
  source: string,
  replacements: Array<{ end: number; replacement: string; start: number }>,
) {
  const merged: typeof replacements = [];
  for (const current of replacements) {
    const previous = merged.at(-1);
    const gap = previous ? source.slice(previous.end, current.start) : "";
    if (previous && /^\s+$/u.test(gap)) {
      previous.end = current.end;
      previous.replacement += gap + current.replacement;
    } else merged.push({ ...current });
  }
  return merged;
}

function byteReplacement(
  source: string,
  replacement: { end: number; replacement: string; start: number },
) {
  return {
    start: Buffer.byteLength(source.slice(0, replacement.start)),
    end: Buffer.byteLength(source.slice(0, replacement.end)),
    replacement: replacement.replacement,
  };
}

function selectedLines(lines: string[], prefixes: Set<string>) {
  return lines
    .filter((line) => prefixes.has(line[0] ?? ""))
    .map((line) => line.slice(1))
    .join("\n");
}

function lineBoundedMatches(source: string, value: string) {
  const matches: number[] = [];
  let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(value, offset);
    if (index < 0) break;
    const end = index + value.length;
    if (lineBoundary(source, index, end)) matches.push(index);
    if (matches.length > 1) break;
    offset = index + Math.max(1, value.length);
  }
  return matches;
}

function lineBoundary(source: string, start: number, end: number) {
  const before = start === 0 || source[start - 1] === "\n";
  const after = end === source.length || source[end] === "\n";
  return before && after;
}
