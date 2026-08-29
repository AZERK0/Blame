import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyPatch, parsePatch } from "diff";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";

const execFileAsync = promisify(execFile);
type Hunk = ReturnType<typeof parsePatch>[number]["hunks"][number];
type PatchHunk = Pick<Hunk, "lines"> & {
  endOfFile?: boolean;
  newStart?: number;
  oldStart?: number;
};
type PatchFile = {
  hunks: PatchHunk[];
  mode: "add" | "delete" | "update";
  newFileName?: string;
  oldFileName?: string;
};
type PatchDocument = {
  files: PatchFile[];
  format: "apply_patch" | "unified";
};

export type PatchRecoveryResult = {
  content: string;
  strategy: "already_applied" | "anchors" | "exact" | "fuzzy" | "three_way";
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
  readonly reason:
    | "INVALID_PATCH_FORMAT"
    | "MULTI_FILE_PATCH"
    | "PATCH_FILE_MODE_UNSUPPORTED"
    | "PATCH_PATH_MISMATCH";
  readonly recommendedTool: "edit_files" | "patch_file";

  constructor(reason: UnsupportedPatchOperation["reason"]) {
    super(
      reason === "MULTI_FILE_PATCH"
        ? "A patch_file request may target only one file."
        : reason === "PATCH_PATH_MISMATCH"
          ? "The patch headers do not target the requested path."
          : reason === "PATCH_FILE_MODE_UNSUPPORTED"
            ? "patch_file updates an existing file; use a file operation for creation or deletion."
            : "The patch contains no valid update hunk.",
    );
    this.reason = reason;
    this.recommendedTool =
      reason === "INVALID_PATCH_FORMAT" || reason === "PATCH_PATH_MISMATCH"
        ? "patch_file"
        : "edit_files";
  }
}

export async function recoverPatch(input: {
  patch: string;
  path: string;
  source: string;
  workspaceRoot: string;
}): Promise<PatchRecoveryResult> {
  const document = parsePatchDocument(input.patch);
  assertSinglePatchTargetDocument(document, input.path);
  const exact = exactPatch(input.source, input.patch, document);
  if (exact !== false && exact !== input.source)
    return { content: exact, strategy: "exact" };
  if (patchAlreadyApplied(input.source, document))
    return { content: input.source, strategy: "already_applied" };
  if (!harnessFeatureEnabled("BLAME_PATCH_RECOVERY_V2"))
    throw patchConflict(input, document, "Exact patch context does not match.");
  const anchored = applyUniqueAnchors(input.source, document);
  if (anchored && anchored !== input.source)
    return { content: anchored, strategy: "anchors" };
  if (hasAmbiguousAnchors(input.source, document))
    throw patchConflict(
      input,
      document,
      "Patch anchors match more than one current location.",
    );
  const fuzzy = fuzzyPatch(input.source, input.patch, document);
  if (fuzzy !== false && fuzzy !== input.source)
    return { content: fuzzy, strategy: "fuzzy" };
  const merged = await threeWayPatch(input, document);
  if (merged && merged !== input.source)
    return { content: merged, strategy: "three_way" };
  throw patchConflict(
    input,
    document,
    "No unique exact, anchor, fuzzy, or three-way resolution exists.",
  );
}

export function assertSinglePatchTarget(patch: string, path: string) {
  assertSinglePatchTargetDocument(parsePatchDocument(patch), path);
}

function assertSinglePatchTargetDocument(
  document: PatchDocument,
  path: string,
) {
  if (document.files.length > 1)
    throw new UnsupportedPatchOperation("MULTI_FILE_PATCH");
  const file = document.files[0];
  if (!file?.hunks.length)
    throw new UnsupportedPatchOperation("INVALID_PATCH_FORMAT");
  if (file.mode !== "update")
    throw new UnsupportedPatchOperation("PATCH_FILE_MODE_UNSUPPORTED");
  const targets = patchFileTargets(file);
  if (targets.length && targets.some((target) => target !== path))
    throw new UnsupportedPatchOperation("PATCH_PATH_MISMATCH");
}

function exactPatch(source: string, patch: string, document: PatchDocument) {
  if (document.format !== "unified") return false;
  const lines = source.split("\n");
  const hunks = parsedHunks(document);
  if (!hunks.length) return false;
  const exact = hunks.every((hunk) => {
    if (hunk.oldStart === undefined) return false;
    const expected = patchLines(hunk, new Set([" ", "-"]));
    return expected.every(
      (line, offset) => lines[hunk.oldStart! - 1 + offset] === line,
    );
  });
  return exact ? applyPatch(source, patch, { fuzzFactor: 0 }) : false;
}

function patchAlreadyApplied(source: string, document: PatchDocument) {
  const lines = source.split("\n");
  const hunks = parsedHunks(document);
  if (!hunks.length) return false;
  return hunks.every((hunk) => {
    const expected = patchLines(hunk, new Set([" ", "+"]));
    if (!expected.length) return false;
    const atExpectedLine =
      hunk.newStart !== undefined &&
      expected.every(
        (line, offset) => lines[hunk.newStart! - 1 + offset] === line,
      ) &&
      (!hunk.endOfFile || sequenceAtEnd(lines, expected) !== undefined);
    const applied = hunk.endOfFile
      ? sequenceAtEnd(lines, expected) !== undefined
      : sequenceMatches(lines, expected).length === 1;
    return atExpectedLine || applied;
  });
}

function applyUniqueAnchors(source: string, document: PatchDocument) {
  const hunks = parsedHunks(document);
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

function hasAmbiguousAnchors(source: string, document: PatchDocument) {
  const lines = source.split("\n");
  return parsedHunks(document).some((hunk) => {
    const expected = patchLines(hunk, new Set([" ", "-"]));
    return expected.length > 0 && sequenceMatches(lines, expected).length > 1;
  });
}

function anchoredReplacement(sourceLines: string[], hunk: PatchHunk) {
  const oldLines = patchLines(hunk, new Set([" ", "-"]));
  const newLines = patchLines(hunk, new Set([" ", "+"]));
  if (!oldLines.length) return undefined;
  if (hunk.endOfFile) {
    const start = sequenceAtEnd(sourceLines, oldLines);
    return start === undefined
      ? undefined
      : { start, deleteCount: oldLines.length, lines: newLines };
  }
  const matches = sequenceMatches(sourceLines, oldLines);
  if (matches.length !== 1) return undefined;
  return { start: matches[0]!, deleteCount: oldLines.length, lines: newLines };
}

function patchLines(hunk: PatchHunk, prefixes: Set<string>) {
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

function sequenceAtEnd(source: string[], expected: string[]) {
  const logicalLength =
    source.at(-1) === "" ? source.length - 1 : source.length;
  const start = logicalLength - expected.length;
  if (start < 0) return undefined;
  return expected.every((line, offset) => source[start + offset] === line)
    ? start
    : undefined;
}

async function threeWayPatch(
  input: {
    patch: string;
    path: string;
    source: string;
    workspaceRoot: string;
  },
  document: PatchDocument,
) {
  if (document.format !== "unified") return undefined;
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
  document: PatchDocument,
  reason: string,
) {
  const hunk = parsedHunks(document)[0];
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

function hunkCandidates(source: string, hunk: PatchHunk) {
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

function fuzzyPatch(source: string, patch: string, document: PatchDocument) {
  if (document.format !== "unified") return false;
  return applyPatch(source, patch, { fuzzFactor: 2 });
}

function parsedHunks(document: PatchDocument) {
  return document.files.flatMap((file) => file.hunks);
}

function parsePatchDocument(patch: string): PatchDocument {
  if (patch.trimStart().startsWith("*** Begin Patch"))
    return parseApplyPatch(patch);
  try {
    const files = parsePatch(patch).map((file) => ({
      hunks: file.hunks.map((hunk) => ({
        lines: hunk.lines,
        newStart: hunk.newStart,
        oldStart: hunk.oldStart,
      })),
      mode: "update" as const,
      ...(file.newFileName ? { newFileName: file.newFileName } : {}),
      ...(file.oldFileName ? { oldFileName: file.oldFileName } : {}),
    }));
    return { files, format: "unified" };
  } catch {
    throw new UnsupportedPatchOperation("INVALID_PATCH_FORMAT");
  }
}

function parseApplyPatch(patch: string): PatchDocument {
  const lines = patch.trim().split(/\r?\n/u);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch")
    throw new UnsupportedPatchOperation("INVALID_PATCH_FORMAT");
  const files: PatchFile[] = [];
  let file: PatchFile | undefined;
  let hunk: PatchHunk | undefined;
  for (const line of lines.slice(1, -1)) {
    const header = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/u);
    if (header) {
      file = applyPatchFile(header[1]!, header[2]!);
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (line.startsWith("@@")) {
      if (!file) throw new UnsupportedPatchOperation("INVALID_PATCH_FORMAT");
      hunk = applyPatchHunk(line);
      file.hunks.push(hunk);
      continue;
    }
    if (line === "*** End of File") {
      if (!hunk) throw new UnsupportedPatchOperation("INVALID_PATCH_FORMAT");
      hunk.endOfFile = true;
      continue;
    }
    if (line.startsWith("*** Move to:"))
      throw new UnsupportedPatchOperation("PATCH_FILE_MODE_UNSUPPORTED");
    if (!hunk || !/^[ +\\-]/u.test(line))
      throw new UnsupportedPatchOperation("INVALID_PATCH_FORMAT");
    if (!line.startsWith("\\")) hunk.lines.push(line);
  }
  return { files, format: "apply_patch" };
}

function applyPatchFile(mode: string, path: string): PatchFile {
  const normalizedMode = mode.toLowerCase() as PatchFile["mode"];
  return {
    hunks: [],
    mode: normalizedMode,
    ...(normalizedMode === "add" ? {} : { oldFileName: path }),
    ...(normalizedMode === "delete" ? {} : { newFileName: path }),
  };
}

function applyPatchHunk(header: string): PatchHunk {
  const positions = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
  return {
    lines: [],
    ...(positions
      ? { oldStart: Number(positions[1]), newStart: Number(positions[2]) }
      : {}),
  };
}

function patchFileTargets(file: PatchFile) {
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

function renderHunk(hunk: PatchHunk) {
  return [
    hunk.oldStart === undefined || hunk.newStart === undefined
      ? "@@"
      : `@@ -${hunk.oldStart} +${hunk.newStart} @@`,
    ...hunk.lines,
  ]
    .join("\n")
    .slice(0, 2_000);
}
