import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyPatch, parsePatch } from "diff";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";

const execFileAsync = promisify(execFile);
type Hunk = ReturnType<typeof parsePatch>[number]["hunks"][number];

export type PatchRecoveryResult = {
  content: string;
  strategy: "anchors" | "exact" | "fuzzy" | "three_way";
};

export class PatchRecoveryConflict extends Error {
  readonly details: {
    failed_hunk: string;
    current_context: string;
    candidates: Array<{ line: number; excerpt: string }>;
    reason: string;
    recommended_strategy: string;
  };

  constructor(
    message: string,
    details: {
      failed_hunk: string;
      current_context: string;
      candidates: Array<{ line: number; excerpt: string }>;
      reason: string;
      recommended_strategy: string;
    },
  ) {
    super(message);
    this.details = details;
  }
}

export class UnsupportedPatchOperation extends Error {
  readonly reason: "MULTI_FILE_PATCH" | "PATCH_PATH_MISMATCH";

  constructor(reason: "MULTI_FILE_PATCH" | "PATCH_PATH_MISMATCH") {
    super(
      reason === "MULTI_FILE_PATCH"
        ? "A patch_file request may target only one file."
        : "The patch headers do not target the requested path.",
    );
    this.reason = reason;
  }
}

export async function recoverPatch(input: {
  patch: string;
  path: string;
  source: string;
  workspaceRoot: string;
}): Promise<PatchRecoveryResult> {
  assertSinglePatchTarget(input.patch, input.path);
  const exact = exactPatch(input.source, input.patch);
  if (exact !== false) return { content: exact, strategy: "exact" };
  if (!harnessFeatureEnabled("BLAME_PATCH_RECOVERY_V2"))
    throw patchConflict(input, "Exact patch context does not match.");
  const anchored = applyUniqueAnchors(input.source, input.patch);
  if (anchored) return { content: anchored, strategy: "anchors" };
  if (hasAmbiguousAnchors(input.source, input.patch))
    throw patchConflict(
      input,
      "Patch anchors match more than one current location.",
    );
  const fuzzy = applyPatch(input.source, input.patch, { fuzzFactor: 2 });
  if (fuzzy !== false) return { content: fuzzy, strategy: "fuzzy" };
  const merged = await threeWayPatch(input);
  if (merged) return { content: merged, strategy: "three_way" };
  throw patchConflict(
    input,
    "No unique exact, anchor, fuzzy, or three-way resolution exists.",
  );
}

export function assertSinglePatchTarget(patch: string, path: string) {
  const files = parsedFiles(patch);
  if (files.length > 1) throw new UnsupportedPatchOperation("MULTI_FILE_PATCH");
  const targets = files.flatMap(patchFileTargets);
  if (targets.length && targets.some((target) => target !== path))
    throw new UnsupportedPatchOperation("PATCH_PATH_MISMATCH");
}

function exactPatch(source: string, patch: string) {
  const lines = source.split("\n");
  const hunks = parsedHunks(patch);
  if (!hunks.length) return false;
  const exact = hunks.every((hunk) => {
    const expected = patchLines(hunk, new Set([" ", "-"]));
    return expected.every(
      (line, offset) => lines[hunk.oldStart - 1 + offset] === line,
    );
  });
  return exact ? applyPatch(source, patch, { fuzzFactor: 0 }) : false;
}

function applyUniqueAnchors(source: string, patch: string) {
  const hunks = parsedHunks(patch);
  if (!hunks.length) return undefined;
  const lines = source.split("\n");
  const replacements = hunks.map((hunk) => anchoredReplacement(lines, hunk));
  if (replacements.some((replacement) => !replacement)) return undefined;
  for (const replacement of replacements.sort(
    (left, right) => right!.start - left!.start,
  )) {
    lines.splice(
      replacement!.start,
      replacement!.deleteCount,
      ...replacement!.lines,
    );
  }
  return lines.join("\n");
}

function hasAmbiguousAnchors(source: string, patch: string) {
  const lines = source.split("\n");
  return parsedHunks(patch).some((hunk) => {
    const expected = patchLines(hunk, new Set([" ", "-"]));
    return expected.length > 0 && sequenceMatches(lines, expected).length > 1;
  });
}

function anchoredReplacement(sourceLines: string[], hunk: Hunk) {
  const oldLines = patchLines(hunk, new Set([" ", "-"]));
  const newLines = patchLines(hunk, new Set([" ", "+"]));
  if (!oldLines.length) return undefined;
  const matches = sequenceMatches(sourceLines, oldLines);
  if (matches.length !== 1) return undefined;
  return { start: matches[0]!, deleteCount: oldLines.length, lines: newLines };
}

function patchLines(hunk: Hunk, prefixes: Set<string>) {
  return hunk.lines
    .filter((line) => prefixes.has(line[0] ?? ""))
    .map((line) => line.slice(1));
}

function sequenceMatches(source: string[], expected: string[]) {
  const matches: number[] = [];
  for (let index = 0; index <= source.length - expected.length; index += 1) {
    if (expected.every((line, offset) => source[index + offset] === line))
      matches.push(index);
    if (matches.length > 1) break;
  }
  return matches;
}

async function threeWayPatch(input: {
  patch: string;
  path: string;
  source: string;
  workspaceRoot: string;
}) {
  const base = await gitBase(input.workspaceRoot, input.path);
  if (base === undefined) return undefined;
  const patchedBase = applyPatch(base, input.patch, { fuzzFactor: 2 });
  if (patchedBase === false) return undefined;
  return mergeFiles(input.source, base, patchedBase);
}

async function gitBase(workspaceRoot: string, path: string) {
  try {
    const result = await execFileAsync("git", ["show", `HEAD:${path}`], {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  } catch {
    return undefined;
  }
}

async function mergeFiles(current: string, base: string, patched: string) {
  const directory = await mkdtemp(join(tmpdir(), "blame-patch-"));
  const paths = {
    current: join(directory, "current"),
    base: join(directory, "base"),
    patched: join(directory, "patched"),
  };
  try {
    await Promise.all([
      writeFile(paths.current, current),
      writeFile(paths.base, base),
      writeFile(paths.patched, patched),
    ]);
    const result = await execFileAsync(
      "git",
      ["merge-file", "-p", paths.current, paths.base, paths.patched],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    return result.stdout;
  } catch {
    return undefined;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function patchConflict(
  input: { patch: string; source: string },
  reason: string,
) {
  const hunk = parsedHunks(input.patch)[0];
  const candidates = hunk ? hunkCandidates(input.source, hunk) : [];
  const probableLine = candidates[0]?.line ?? hunk?.oldStart ?? 1;
  return new PatchRecoveryConflict("The patch could not be applied safely.", {
    failed_hunk: hunk ? renderHunk(hunk) : input.patch.slice(0, 2_000),
    current_context: contextAt(input.source, probableLine),
    candidates,
    reason,
    recommended_strategy:
      candidates.length > 1
        ? "Choose one candidate and use a semantic edit or a narrower patch."
        : "Use the returned current context to issue one narrower patch.",
  });
}

function hunkCandidates(source: string, hunk: Hunk) {
  const lines = source.split("\n");
  const anchors = patchLines(hunk, new Set([" ", "-"]))
    .filter(Boolean)
    .slice(0, 3);
  const matches: Array<{ line: number; excerpt: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!anchors.some((anchor) => lines[index]?.includes(anchor.trim())))
      continue;
    matches.push({
      line: index + 1,
      excerpt: lines
        .slice(index, index + 3)
        .join("\n")
        .slice(0, 320),
    });
    if (matches.length >= 5) break;
  }
  return matches;
}

function contextAt(source: string, line: number) {
  const lines = source.split("\n");
  return lines
    .slice(Math.max(0, line - 4), line + 3)
    .join("\n")
    .slice(0, 1_000);
}

function parsedHunks(patch: string) {
  return parsedFiles(patch).flatMap((file) => file.hunks);
}

function parsedFiles(patch: string) {
  try {
    return parsePatch(patch);
  } catch {
    return [];
  }
}

function patchFileTargets(file: ReturnType<typeof parsePatch>[number]) {
  return [file.oldFileName, file.newFileName]
    .filter((value): value is string => Boolean(value && value !== "/dev/null"))
    .map(normalizePatchPath);
}

function normalizePatchPath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("a/") || normalized.startsWith("b/")
    ? normalized.slice(2)
    : normalized;
}

function renderHunk(hunk: Hunk) {
  return [
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    ...hunk.lines,
  ]
    .join("\n")
    .slice(0, 2_000);
}
