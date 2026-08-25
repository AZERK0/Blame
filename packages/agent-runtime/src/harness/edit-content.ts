export function applyCssDeclarations(
  source: string,
  declarations: Record<string, string | null>,
) {
  const open = source.indexOf("{");
  const close = source.lastIndexOf("}");
  if (open < 0 || close <= open)
    throw new Error("The CSS rule has no declaration block.");
  const body = source.slice(open + 1, close);
  const entries = new Map<string, string>();
  for (const match of body.matchAll(/([\w-]+)\s*:\s*([^;{}]*);?/gu))
    entries.set(match[1]!, match[2]!.trim());
  for (const [name, value] of Object.entries(declarations)) {
    if (value === null) entries.delete(name);
    else entries.set(name, value);
  }
  const indentation = body.match(/\n([ \t]+)\S/u)?.[1] ?? "  ";
  const closingIndentation =
    source.slice(0, open).match(/(^|\n)([ \t]*)[^\n]*$/u)?.[2] ?? "";
  const rendered = [...entries]
    .map(([name, value]) => `${indentation}${name}: ${value};`)
    .join("\n");
  return `${source.slice(0, open + 1)}\n${rendered}\n${closingIndentation}}${source.slice(close + 1)}`;
}

export function lineChanges(before?: Buffer, after?: Buffer) {
  const beforeCounts = occurrenceCounts(lines(before));
  const afterCounts = occurrenceCounts(lines(after));
  let additions = 0;
  let deletions = 0;
  for (const [line, count] of afterCounts)
    additions += Math.max(0, count - (beforeCounts.get(line) ?? 0));
  for (const [line, count] of beforeCounts)
    deletions += Math.max(0, count - (afterCounts.get(line) ?? 0));
  return { additions, deletions };
}

function lines(content?: Buffer) {
  return content ? content.toString("utf8").split("\n") : [];
}

function occurrenceCounts(lines: string[]) {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}
