import { parseCode } from "./code-intelligence.js";
import type { ByteInterval } from "./read-coverage.js";

export function pythonBodyRange(
  content: Buffer,
  range: ByteInterval,
): ByteInterval {
  const start = lineStart(content, range[0]);
  const prefix = content.subarray(start, range[0]).toString("utf8");
  return /^[\t ]*$/u.test(prefix) ? [start, range[1]] : range;
}

export function pythonBodyReplacement(
  content: Buffer,
  range: ByteInterval,
  body: string,
) {
  const prefix = content
    .subarray(lineStart(content, range[0]), range[0])
    .toString("utf8");
  const inline = Boolean(prefix.trim());
  if (inline && !body.trim().includes("\n")) return body.trim();
  const current = content.subarray(...range).toString("utf8");
  const base = (inline ? prefix : current).match(/^[\t ]*/u)?.[0] ?? "";
  const indent = inline ? base + (base.includes("\t") ? "\t" : "    ") : base;
  const newline = content.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
  const normalized = reindentPythonBody(body, indent, newline);
  return inline ? newline + normalized : normalized;
}

function lineStart(content: Buffer, offset: number) {
  return offset > 0 ? content.lastIndexOf(10, offset - 1) + 1 : 0;
}

function reindentPythonBody(body: string, indent: string, newline: string) {
  const input = body.split(/\r?\n/u);
  const first = input.findIndex((line) => line.trim());
  const lines = first < 0 ? [] : input.slice(first);
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  const protectedLines = multilineStringLines(lines.join("\n"));
  const widths = lines.flatMap((line, index) =>
    line.trim() && !protectedLines.has(index)
      ? [line.match(/^[\t ]*/u)![0].length]
      : [],
  );
  const width = widths.reduce((minimum, value) => Math.min(minimum, value), Infinity);
  return lines
    .map((line, index) => {
      if (protectedLines.has(index)) return line;
      return line.trim() ? indent + line.slice(width) : "";
    })
    .join(newline);
}

function multilineStringLines(source: string) {
  const tree = parseCode("body.py", Buffer.from(source)).trees[0];
  const strings = tree?.root.findAll({ rule: { kind: "string" } }) ?? [];
  return new Set(
    strings.flatMap((node) => {
      const { start, end } = node.range();
      return Array.from(
        { length: end.line - start.line },
        (_, index) => start.line + index + 1,
      );
    }),
  );
}
