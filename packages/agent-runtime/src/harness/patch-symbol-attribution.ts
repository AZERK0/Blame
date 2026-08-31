import { parseCode, type ParsedSymbol } from "./code-intelligence.js";
import type { LightPatchPlan, LightPatchReplacement } from "./light-patch.js";

export function symbolsTouchedByPatch(
  path: string,
  content: Buffer | null,
  patch: LightPatchPlan,
) {
  if (!content || patch.mode !== "update") return [];
  const parsed = parseCode(path, content);
  if (!parsed.supported) return [];
  return [
    ...new Set(
      patch.replacements.flatMap((replacement) => {
        const symbol = smallestContainingSymbol(parsed.symbols, replacement);
        return symbol ? [symbol.qualified_name] : [];
      }),
    ),
  ];
}

function smallestContainingSymbol(
  symbols: ParsedSymbol[],
  replacement: LightPatchReplacement,
) {
  return symbols
    .filter((symbol) =>
      containsReplacement(symbol.range_utf8_bytes, replacement),
    )
    .sort(
      (left, right) =>
        rangeSize(left.range_utf8_bytes) - rangeSize(right.range_utf8_bytes),
    )[0];
}

function containsReplacement(
  range: [number, number],
  replacement: LightPatchReplacement,
) {
  if (replacement.start === replacement.end)
    return range[0] < replacement.start && replacement.start < range[1];
  return range[0] <= replacement.start && replacement.end <= range[1];
}

function rangeSize([start, end]: [number, number]) {
  return end - start;
}
