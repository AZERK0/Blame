import type { ResolvedLightSymbol } from "./light-aliases.js";
import type { LightEditCodeInput } from "./light-contracts.js";
import { symbolEditRange, syntaxBoundaryRange } from "./code-intelligence.js";
import { capabilityForPath } from "./light-capabilities.js";
import { pythonBodyRange, pythonBodyReplacement } from "./python-body.js";

export type Replacement = {
  end: number;
  replacement: string;
  source: string;
  start: number;
};

export function symbolReplacement(
  resolved: ResolvedLightSymbol,
  operation: Extract<
    LightEditCodeInput["operations"][number],
    { kind: "symbol" }
  >,
): Replacement {
  if (operation.action === "rename") throw new Error("Semantic rename requires the compiler planner.");
  const replacement = operation.content ?? "";
  const source = `${operation.action} ${operation.target}`;
  if (operation.action === "replace_body")
    return symbolBodyReplacement(resolved, replacement, source);
  const range = syntaxBoundaryRange(
    resolved.path,
    resolved.content,
    resolved.symbol.range_utf8_bytes,
  );
  if (operation.action === "insert_before")
    return insertionReplacement(range[0], replacement, source);
  if (operation.action === "insert_after")
    return insertionReplacement(range[1], replacement, source);
  return wholeSymbolReplacement(operation, range, source, resolved);
}

function symbolBodyReplacement(
  resolved: ResolvedLightSymbol,
  replacement: string,
  source: string,
): Replacement {
  const range = symbolEditRange(resolved.symbol, "body");
  if (capabilityForPath(resolved.path)?.language === "python") {
    const [start, end] = pythonBodyRange(resolved.content, range);
    return {
      start, end, source,
      replacement: pythonBodyReplacement(resolved.content, [start, end], replacement),
    };
  }
  const [start, end] = range;
  const current = resolved.content.subarray(start, end).toString("utf8");
  const baseIndent = lineIndentBefore(resolved.content, start);
  return {
    start,
    end,
    replacement: normalizedSymbolBody(current, replacement, baseIndent),
    source,
  };
}

function normalizedSymbolBody(
  current: string,
  replacement: string,
  baseIndent: string,
) {
  const currentBody = current.trim();
  const proposedBody = replacement.trim();
  if (!isDelimitedBody(currentBody) || isDelimitedBody(proposedBody))
    return replacement;
  if (!proposedBody.includes("\n")) return `{ ${proposedBody} }`;
  const indent = existingBodyIndent(current) ?? `${baseIndent}  `;
  return `{\n${indentedStatements(replacement, indent)}\n${baseIndent}}`;
}

function isDelimitedBody(value: string) {
  return value.startsWith("{") && value.endsWith("}");
}

function lineIndentBefore(content: Buffer, offset: number) {
  const prefix = content.subarray(0, offset).toString("utf8");
  return prefix.match(/(?:^|\n)([\t ]*)[^\n]*$/u)?.[1] ?? "";
}

function existingBodyIndent(body: string) {
  return body.match(/\n([\t ]+)\S/u)?.[1];
}

function indentedStatements(value: string, indent: string) {
  const allLines = value.split(/\r?\n/u);
  const start = allLines.findIndex((line) => line.trim());
  const trailing = [...allLines].reverse().findIndex((line) => line.trim());
  const end = allLines.length - trailing - 1;
  const lines = allLines.slice(start, end + 1);
  const widths = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[\t ]*/u)?.[0].length ?? 0);
  const width = Math.min(...widths);
  return lines
    .map((line) => (line.trim() ? `${indent}${line.slice(width)}` : ""))
    .join("\n");
}

function insertionReplacement(
  offset: number,
  replacement: string,
  source: string,
): Replacement {
  return { start: offset, end: offset, replacement, source };
}

function wholeSymbolReplacement(
  operation: Extract<
    LightEditCodeInput["operations"][number],
    { kind: "symbol" }
  >,
  range: [number, number],
  source: string,
  resolved: ResolvedLightSymbol,
): Replacement {
  return {
    start: range[0],
    end: range[1],
    replacement: operation.action === "delete" ? "" :
      withoutRepeatedFirstLineIndent(resolved, range[0], operation.content ?? ""),
    source,
  };
}

function withoutRepeatedFirstLineIndent(
  resolved: ResolvedLightSymbol,
  start: number,
  replacement: string,
) {
  const language = capabilityForPath(resolved.path)?.language;
  if (!["javascript", "typescript", "jsx", "tsx"].includes(language ?? ""))
    return replacement;
  if (start === 0) return replacement;
  const lineStart = resolved.content.lastIndexOf(10, start - 1) + 1;
  const prefix = resolved.content.subarray(lineStart, start).toString("utf8");
  // The AST span starts after this whitespace, which remains in the file.
  // Accept the same absolute first-line indent once. Never reindent later
  // lines: they may contain template literals or explicitly chosen layout.
  return /^[\t ]+$/u.test(prefix) && replacement.startsWith(prefix)
    ? replacement.slice(prefix.length) : replacement;
}
