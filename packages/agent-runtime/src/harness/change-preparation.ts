import { createTwoFilesPatch } from "diff";
import { isBinaryFileSync } from "isbinaryfile";
import { parseCode } from "./code-intelligence.js";
import { decodeHandle, sha256 } from "./protocol.js";
import type {
  ChangeOperation,
  ParseDiagnostic,
  ProposeChangeInput,
} from "./schemas.js";
import {
  assertMutableWorkspacePath,
  type WorkspaceFiles,
} from "./workspace-files.js";

type SpanEdit = {
  path: string;
  start: number;
  end: number;
  replacement: Buffer;
};

type VirtualFile = {
  initial: Buffer | null;
  current: Buffer | null;
  initialMode: number | null;
  currentMode: number | null;
};

type FileOperation = Extract<
  ChangeOperation,
  { kind: "create_file" | "delete_file" | "move_file" }
>;

export type PreparedFile = {
  path: string;
  oldContent: Buffer | null;
  newContent: Buffer | null;
  oldHash: string | null;
  newHash: string | null;
  oldMode: number | null;
  newMode: number | null;
  binary: boolean;
};

export async function prepareChanges(
  files: WorkspaceFiles,
  input: ProposeChangeInput,
) {
  const virtual = new Map<string, VirtualFile>();
  const edits: SpanEdit[] = [];
  const fileOperations: FileOperation[] = [];
  for (const operation of input.operations) {
    if (
      operation.kind === "replace_node" ||
      operation.kind === "insert_before" ||
      operation.kind === "insert_after"
    ) {
      const handle = decodeHandle(operation.target, "node");
      if (!handle) throw new Error("A valid node_ref is required.");
      if (handle.revision !== input.base_source_revision_id)
        throw staleRevision(input.base_source_revision_id);
      const file = await loadVirtualFile(files, virtual, handle.path);
      if (!file.initial) throw new Error("Node target file no longer exists.");
      const fragment = file.initial.subarray(handle.start, handle.end);
      if (sha256(fragment) !== handle.digest)
        throw new Error("Node precondition failed: target bytes changed.");
      edits.push({
        path: handle.path,
        start: operation.kind === "insert_after" ? handle.end : handle.start,
        end:
          operation.kind === "replace_node"
            ? handle.end
            : operation.kind === "insert_after"
              ? handle.end
              : handle.start,
        replacement: Buffer.from(
          operation.kind === "replace_node"
            ? operation.replacement
            : operation.source,
        ),
      });
    } else if (operation.kind === "text_replace") {
      const path = checkedPath(files, operation.path);
      const file = await loadVirtualFile(files, virtual, path);
      if (
        !file.initial ||
        sha256(file.initial) !== operation.expected_blob_hash
      )
        throw new Error(`Blob precondition failed for ${path}.`);
      const [start, end] = validRange(
        operation.range_utf8_bytes,
        file.initial.length,
      );
      if (
        !file.initial
          .subarray(start, end)
          .equals(Buffer.from(operation.expected_old_text))
      )
        throw new Error(`Old text precondition failed for ${path}.`);
      edits.push({
        path,
        start,
        end,
        replacement: Buffer.from(operation.replacement),
      });
    } else {
      fileOperations.push(operation);
    }
  }

  applySpanEdits(edits, virtual);
  for (const operation of fileOperations)
    await applyFileOperation(files, virtual, operation);
  return changedFiles(virtual);
}

export function parseDiagnostic(change: PreparedFile): ParseDiagnostic {
  if (change.binary)
    return {
      path: change.path,
      before_errors: 0,
      after_errors: 0,
      analysis: "unsupported",
    };
  const before = change.oldContent
    ? parseCode(change.path, change.oldContent)
    : undefined;
  const after = change.newContent
    ? parseCode(change.path, change.newContent)
    : undefined;
  return {
    path: change.path,
    before_errors: before?.errorCount ?? 0,
    after_errors: after?.errorCount ?? 0,
    analysis: before?.supported || after?.supported ? "parser" : "unsupported",
  };
}

export function fileDiff(change: PreparedFile) {
  if (change.binary)
    return [
      `diff --git a/${change.path} b/${change.path}`,
      `Binary files a/${change.path} and b/${change.path} differ`,
      `old-sha256 ${change.oldHash ?? "deleted"}`,
      `new-sha256 ${change.newHash ?? "deleted"}`,
    ].join("\n");
  return createTwoFilesPatch(
    `a/${change.path}`,
    `b/${change.path}`,
    change.oldContent?.toString("utf8") ?? "",
    change.newContent?.toString("utf8") ?? "",
    undefined,
    undefined,
    { context: 3, maxEditLength: 100_000, timeout: 1_000 },
  );
}

async function loadVirtualFile(
  files: WorkspaceFiles,
  virtual: Map<string, VirtualFile>,
  pathInput: string,
) {
  const path = checkedPath(files, pathInput);
  const existing = virtual.get(path);
  if (existing) return existing;
  try {
    const value = await files.read(path);
    const entry = {
      initial: value.content,
      current: value.content,
      initialMode: value.mode,
      currentMode: value.mode,
    };
    virtual.set(path, entry);
    return entry;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const entry = {
    initial: null,
    current: null,
    initialMode: null,
    currentMode: null,
  };
  virtual.set(path, entry);
  return entry;
}

function applySpanEdits(edits: SpanEdit[], virtual: Map<string, VirtualFile>) {
  const byPath = new Map<string, SpanEdit[]>();
  for (const edit of edits)
    byPath.set(edit.path, [...(byPath.get(edit.path) ?? []), edit]);
  for (const [path, pathEdits] of byPath) {
    const file = virtual.get(path);
    if (!file?.initial) throw new Error(`Edit target ${path} does not exist.`);
    const descending = pathEdits.sort(
      (left, right) => right.start - left.start,
    );
    let boundary = file.initial.length;
    let result = file.initial;
    for (const edit of descending) {
      if (edit.end > boundary)
        throw new Error(`Overlapping edits for ${path}.`);
      result = Buffer.concat([
        result.subarray(0, edit.start),
        edit.replacement,
        result.subarray(edit.end),
      ]);
      boundary = edit.start;
    }
    file.current = result;
  }
}

async function applyFileOperation(
  files: WorkspaceFiles,
  virtual: Map<string, VirtualFile>,
  operation: FileOperation,
) {
  if (operation.kind === "create_file") {
    const file = await loadVirtualFile(files, virtual, operation.path);
    if (file.current)
      throw new Error(`Create target ${operation.path} already exists.`);
    file.current = Buffer.from(operation.content);
    file.currentMode = 0o644;
    return;
  }
  if (operation.kind === "delete_file") {
    const file = await loadVirtualFile(files, virtual, operation.path);
    verifyBlob(file, operation.expected_blob_hash, operation.path);
    file.current = null;
    file.currentMode = null;
    return;
  }
  const from = await loadVirtualFile(files, virtual, operation.from_path);
  verifyBlob(from, operation.expected_blob_hash, operation.from_path);
  const to = await loadVirtualFile(files, virtual, operation.to_path);
  if (to.current)
    throw new Error(`Move target ${operation.to_path} already exists.`);
  to.current = from.current;
  to.currentMode = from.currentMode;
  from.current = null;
  from.currentMode = null;
}

function changedFiles(virtual: Map<string, VirtualFile>): PreparedFile[] {
  return [...virtual.entries()]
    .filter(([, file]) => !buffersEqual(file.initial, file.current))
    .map(([path, file]) => ({
      path,
      oldContent: file.initial,
      newContent: file.current,
      oldHash: file.initial ? sha256(file.initial) : null,
      newHash: file.current ? sha256(file.current) : null,
      oldMode: file.initialMode,
      newMode: file.currentMode,
      binary:
        (file.initial ? isBinaryFileSync(file.initial) : false) ||
        (file.current ? isBinaryFileSync(file.current) : false),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function checkedPath(files: WorkspaceFiles, input: string) {
  const path = files.normalizePath(input);
  assertMutableWorkspacePath(path);
  return path;
}

function validRange(value: [number, number], maximum: number) {
  if (
    !Number.isSafeInteger(value[0]) ||
    !Number.isSafeInteger(value[1]) ||
    value[0] < 0 ||
    value[1] < value[0] ||
    value[1] > maximum
  )
    throw new Error("range_utf8_bytes is outside the target file.");
  return value;
}

function verifyBlob(file: VirtualFile, expected: string, path: string) {
  if (!file.initial || sha256(file.initial) !== expected)
    throw new Error(`Blob precondition failed for ${path}.`);
}

function buffersEqual(left: Buffer | null, right: Buffer | null) {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function staleRevision(current: string) {
  return new Error(`STALE_REVISION:${current}`);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
