import { computePatchChanges, PatchActionType } from "@cline/sdk";
import type { PatchFileChange } from "@cline/sdk";
import { diffChars } from "diff";

export type LightPatchReplacement = {
  end: number;
  replacement: string;
  start: number;
};

export type LightPatchPlan =
  | { mode: "add"; content: string }
  | { mode: "delete" }
  | { mode: "update"; replacements: LightPatchReplacement[] };

type ParsedPatch = {
  headerIndex: number;
  hunks: string[][];
  mode: "add" | "delete" | "update";
  lines: string[];
};

export async function planLightPatch(
  workspaceRoot: string,
  path: string,
  source: string | undefined,
  patch: string,
) {
  const parsed = parseClinePatchShape(patch);
  assertExactUniqueContexts(source, parsed);
  const normalized = normalizedPatch(parsed, path);
  const change = await computeSingleChange(normalized, workspaceRoot);
  return patchPlanFromChange(change, source);
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
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch")
    throw new Error("Patch must use the Cline Apply Patch format.");
  const headerIndexes = lines.flatMap((line, index) =>
    /^\*\*\* (?:Add|Delete|Update) File:/u.test(line) ? [index] : [],
  );
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
) {
  if (parsed.mode !== "update") return;
  if (source === undefined)
    throw new Error("Patch update target does not exist.");
  for (const hunk of parsed.hunks) {
    const context = selectedLines(hunk, new Set([" ", "-"]));
    if (!context) throw new Error("Update hunks require exact context.");
    const matches = lineBoundedMatches(source, context);
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? "Patch context is ambiguous."
          : "Patch context does not match.",
      );
  }
}

function normalizedPatch(parsed: ParsedPatch, path: string) {
  const lines = [...parsed.lines];
  const label = `${parsed.mode[0]!.toUpperCase()}${parsed.mode.slice(1)}`;
  lines[parsed.headerIndex] = `*** ${label} File: ${path}`;
  return lines.join("\n");
}

function changedRanges(before: string, after: string) {
  const replacements: LightPatchReplacement[] = [];
  let cursor = 0;
  let pending: { end: number; replacement: string; start: number } | undefined;
  for (const part of diffChars(before, after)) {
    if (!part.added && !part.removed) {
      if (pending) replacements.push(byteReplacement(before, pending));
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
  if (pending) replacements.push(byteReplacement(before, pending));
  return replacements;
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
