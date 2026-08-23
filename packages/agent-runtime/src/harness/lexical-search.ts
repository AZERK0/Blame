import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { rgPath } from "@vscode/ripgrep";
import type { SearchCodeInput } from "./schemas.js";

type TextQuery = Extract<SearchCodeInput["query"], { kind: "text" }>;

export type LexicalSearchMatch = {
  path: string;
  line_range: [number, number];
  range_utf8_bytes: [number, number];
  excerpt: string;
  match_reason: "lexical_exact" | "lexical_regex";
};

export type LexicalSearchResult = {
  available: boolean;
  engine: "node" | "ripgrep";
  items: LexicalSearchMatch[];
  truncated: boolean;
};

type RipgrepEvent = {
  type?: string;
  data?: {
    absolute_offset?: number;
    line_number?: number;
    lines?: EncodedText;
    path?: EncodedText;
    submatches?: Array<{
      end?: number;
      match?: EncodedText;
      start?: number;
    }>;
  };
};

type EncodedText = { bytes?: string; text?: string };

export async function searchWithRipgrep(input: {
  candidates: string[];
  maximum: number;
  query: TextQuery;
  root: string;
  scopePaths?: string[];
  signal?: AbortSignal;
}): Promise<LexicalSearchResult> {
  input.signal?.throwIfAborted();
  const command = ripgrepCommand();
  const candidateSet = new Set(input.candidates);
  if (candidateSet.size === 0)
    return {
      available: true,
      engine: "ripgrep",
      items: [],
      truncated: false,
    };
  const roots = searchRoots(input.scopePaths);
  const args = [
    "--json",
    "--no-config",
    "--no-messages",
    "--hidden",
    "--sort",
    "path",
    "--max-filesize",
    "2M",
    "--max-count",
    String(input.maximum),
    "--glob",
    "!.blame/**",
    "--glob",
    "!.code-review-graph/**",
    ...(input.query.case_sensitive ? [] : ["--ignore-case"]),
    ...(input.query.regex ? [] : ["--fixed-strings"]),
    "--",
    input.query.pattern,
    ...roots,
  ];
  const child = spawn(command, args, {
    cwd: input.root,
    env: process.env,
    signal: input.signal,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const items: LexicalSearchMatch[] = [];
  const errors: Buffer[] = [];
  let limited = false;
  let unavailable = false;
  const completionPromise = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
  child.on("error", (error) => {
    if (errorCode(error) === "ENOENT") unavailable = true;
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      const event = parseEvent(line);
      if (event?.type !== "match" || !event.data) continue;
      const path = text(event.data.path)
        ?.replaceAll("\\", "/")
        .replace(/^\.\//u, "");
      const absoluteOffset = event.data.absolute_offset;
      const lineNumber = event.data.line_number;
      const lineContent = text(event.data.lines);
      if (
        !path ||
        !candidateSet.has(path) ||
        !Number.isSafeInteger(absoluteOffset) ||
        !Number.isSafeInteger(lineNumber) ||
        lineContent === undefined
      )
        continue;
      const lineBytes = Buffer.from(lineContent);
      for (const submatch of event.data.submatches ?? []) {
        if (
          !Number.isSafeInteger(submatch.start) ||
          !Number.isSafeInteger(submatch.end) ||
          submatch.start! < 0 ||
          submatch.end! < submatch.start! ||
          submatch.end! > lineBytes.byteLength
        )
          continue;
        const matched =
          text(submatch.match) ??
          lineBytes.subarray(submatch.start, submatch.end).toString("utf8");
        const precedingLines = countNewlines(
          lineBytes.subarray(0, submatch.start),
        );
        const startLine = lineNumber! + precedingLines;
        const start = absoluteOffset! + submatch.start!;
        items.push({
          path,
          line_range: [
            startLine,
            startLine + countNewlines(Buffer.from(matched)),
          ],
          range_utf8_bytes: [start, absoluteOffset! + submatch.end!],
          excerpt: compactLine(lineContent),
          match_reason: input.query.regex ? "lexical_regex" : "lexical_exact",
        });
        if (items.length >= input.maximum) {
          limited = true;
          child.kill();
          break;
        }
      }
      if (limited) break;
    }
  } finally {
    lines.close();
  }

  const completion = await completionPromise;
  if (unavailable)
    return { available: false, engine: "node", items: [], truncated: false };
  if (
    !limited &&
    completion.code !== 0 &&
    completion.code !== 1 &&
    !input.signal?.aborted
  )
    throw new Error(
      `ripgrep failed: ${Buffer.concat(errors).toString("utf8").trim() || `exit ${completion.code}`}`,
    );
  input.signal?.throwIfAborted();
  return {
    available: true,
    engine: "ripgrep",
    items,
    truncated: limited,
  };
}

function searchRoots(paths?: string[]) {
  if (!paths?.length) return ["."];
  return [...new Set(paths.map((path) => path.replaceAll("\\", "/")))];
}

function ripgrepCommand() {
  const configured = process.env.BLAME_RIPGREP_COMMAND?.trim();
  if (configured) return configured;
  return rgPath.includes("app.asar")
    ? rgPath.replace("app.asar", "app.asar.unpacked")
    : rgPath || "rg";
}

function parseEvent(line: string): RipgrepEvent | undefined {
  try {
    return JSON.parse(line) as RipgrepEvent;
  } catch {
    return undefined;
  }
}

function text(value?: EncodedText) {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.bytes === "string")
    return Buffer.from(value.bytes, "base64").toString("utf8");
  return undefined;
}

function compactLine(value: string) {
  const compact = value.trimEnd();
  return compact.length > 500 ? `${compact.slice(0, 499)}…` : compact;
}

function countNewlines(value: Buffer) {
  let count = 0;
  for (const byte of value) if (byte === 10) count += 1;
  return count;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
