import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { rgPath } from "@vscode/ripgrep";
import { packagedResourcePath } from "./packaged-resource-path.js";

type TextQuery = {
  case_sensitive?: boolean;
  pattern: string;
  regex?: boolean;
};

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
    submatches?: RipgrepSubmatch[];
  };
};

type EncodedText = { bytes?: string; text?: string };
type RipgrepSubmatch = { end?: number; match?: EncodedText; start?: number };

type RipgrepSearchInput = {
  candidates: string[];
  maximum: number;
  query: TextQuery;
  root: string;
  scopePaths?: string[];
  signal?: AbortSignal;
};

export async function searchWithRipgrep(
  input: RipgrepSearchInput,
): Promise<LexicalSearchResult> {
  input.signal?.throwIfAborted();
  const candidateSet = new Set(input.candidates);
  if (!candidateSet.size) return emptySearchResult();
  const child = spawn(ripgrepCommand(), ripgrepArguments(input), {
    cwd: input.root,
    env: process.env,
    signal: input.signal,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const processState = observeProcess(child);
  const search = await collectMatches(child, input, candidateSet);
  const completion = await processState.completion;
  return finalizeSearch(input, search, completion, processState);
}

function ripgrepArguments(input: RipgrepSearchInput) {
  return [
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
    ...searchRoots(input.scopePaths),
  ];
}

function observeProcess(child: ReturnType<typeof spawn>) {
  const state = {
    errors: [] as Buffer[],
    unavailable: false,
    completion: new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    }),
  };
  child.stderr?.on("data", (chunk) => state.errors.push(Buffer.from(chunk)));
  child.on("error", (error) => {
    if (errorCode(error) === "ENOENT") state.unavailable = true;
  });
  return state;
}

async function collectMatches(
  child: ReturnType<typeof spawn>,
  input: RipgrepSearchInput,
  candidates: Set<string>,
) {
  const items: LexicalSearchMatch[] = [];
  let limited = false;
  const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const matches = eventMatches(parseEvent(line), input, candidates);
      items.push(...matches.slice(0, input.maximum - items.length));
      limited = items.length >= input.maximum;
      if (limited) child.kill();
      if (limited) break;
    }
  } finally {
    lines.close();
  }

  return { items, limited };
}

function eventMatches(
  event: RipgrepEvent | undefined,
  input: RipgrepSearchInput,
  candidates: Set<string>,
) {
  if (event?.type !== "match" || !event.data) return [];
  const data = event.data;
  const path = text(data.path)?.replaceAll("\\", "/").replace(/^\.\//u, "");
  const lineContent = text(data.lines);
  if (
    !path ||
    !candidates.has(path) ||
    !Number.isSafeInteger(data.absolute_offset) ||
    !Number.isSafeInteger(data.line_number) ||
    lineContent === undefined
  )
    return [];
  return (data.submatches ?? []).flatMap((submatch) =>
    submatchResult(data, submatch, path, lineContent, input.query.regex),
  );
}

function submatchResult(
  data: NonNullable<RipgrepEvent["data"]>,
  submatch: RipgrepSubmatch,
  path: string,
  lineContent: string,
  regex?: boolean,
): LexicalSearchMatch[] {
  const lineBytes = Buffer.from(lineContent);
  if (!validSubmatch(submatch, lineBytes.byteLength)) return [];
  const matched =
    text(submatch.match) ??
    lineBytes.subarray(submatch.start, submatch.end).toString("utf8");
  const startLine =
    data.line_number! + countNewlines(lineBytes.subarray(0, submatch.start));
  const start = data.absolute_offset! + submatch.start!;
  return [
    {
      path,
      line_range: [startLine, startLine + countNewlines(Buffer.from(matched))],
      range_utf8_bytes: [start, data.absolute_offset! + submatch.end!],
      excerpt: compactLine(lineContent),
      match_reason: regex ? "lexical_regex" : "lexical_exact",
    },
  ];
}

function validSubmatch(
  submatch: { end?: number; start?: number },
  lineLength: number,
) {
  return (
    Number.isSafeInteger(submatch.start) &&
    Number.isSafeInteger(submatch.end) &&
    submatch.start! >= 0 &&
    submatch.end! >= submatch.start! &&
    submatch.end! <= lineLength
  );
}

function finalizeSearch(
  input: RipgrepSearchInput,
  search: { items: LexicalSearchMatch[]; limited: boolean },
  completion: { code: number | null },
  state: { errors: Buffer[]; unavailable: boolean },
): LexicalSearchResult {
  if (state.unavailable) return unavailableSearchResult();
  if (
    !search.limited &&
    completion.code !== 0 &&
    completion.code !== 1 &&
    !input.signal?.aborted
  )
    throw new Error(
      `ripgrep failed: ${Buffer.concat(state.errors).toString("utf8").trim() || `exit ${completion.code}`}`,
    );
  input.signal?.throwIfAborted();
  return {
    available: true,
    engine: "ripgrep",
    items: search.items,
    truncated: search.limited,
  };
}

function emptySearchResult(): LexicalSearchResult {
  return { available: true, engine: "ripgrep", items: [], truncated: false };
}

function unavailableSearchResult(): LexicalSearchResult {
  return { available: false, engine: "node", items: [], truncated: false };
}

function searchRoots(paths?: string[]) {
  if (!paths?.length) return ["."];
  return [...new Set(paths.map((path) => path.replaceAll("\\", "/")))];
}

function ripgrepCommand() {
  const configured = process.env.BLAME_RIPGREP_COMMAND?.trim();
  if (configured) return configured;
  return packagedResourcePath(rgPath) || "rg";
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
