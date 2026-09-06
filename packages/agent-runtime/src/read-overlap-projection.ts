type Span = { start: number; end: number };
type ProjectedText = { content: string; retained: string[] };

const overlapMarker = "[… exact source repeated in a later read …]\n";

export function projectReadOverlap(
  data: Record<string, unknown>,
  references: string[],
) {
  const retained: string[] = [];
  const project = (value: unknown) => {
    if (typeof value !== "string") return value;
    const result = projectText(value, references);
    retained.push(...result.retained);
    return result.content;
  };
  const projected = { ...data };
  for (const key of ["content", "signature", "body", "imports"])
    if (key in data) projected[key] = project(data[key]);
  if (Array.isArray(data.segments))
    projected.segments = data.segments.map((segment: unknown) =>
      segment && typeof segment === "object" && "content" in segment
        ? { ...segment, content: project(segment.content) }
        : segment,
    );
  const changed = JSON.stringify(projected) !== JSON.stringify(data);
  return { data: projected, retained, changed };
}

function projectText(source: string, references: string[]): ProjectedText {
  if (source.length < 256) return { content: source, retained: [source] };
  const lines = source.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const spans = references.flatMap((reference) =>
    matchingSpans(lines, reference),
  );
  return removeSpans(source, mergeSpans(spans));
}

function matchingSpans(lines: string[], reference: string): Span[] {
  const other = reference.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const positions = uniqueLinePositions(other);
  const sourcePositions = uniqueLinePositions(lines);
  const offsets = lineOffsets(lines);
  const spans: Span[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const target = positions.get(lines[index]!);
    if (
      target === undefined ||
      target < 0 ||
      sourcePositions.get(lines[index]!) !== index
    )
      continue;
    const run = matchingRun(lines, other, index, target);
    const start = offsets[run.start]!;
    const end = offsets[run.end]!;
    if (run.end - run.start >= 3 && end - start >= 256)
      spans.push({ start, end });
    index = run.end - 1;
  }
  return spans;
}

function matchingRun(
  source: string[],
  target: string[],
  left: number,
  right: number,
) {
  let start = left;
  let end = left + 1;
  while (
    start > 0 &&
    right - (left - start) > 0 &&
    source[start - 1] === target[right - (left - start) - 1]
  )
    start -= 1;
  while (end < source.length && source[end] === target[right + end - left])
    end += 1;
  return { start, end };
}

function uniqueLinePositions(lines: string[]) {
  const positions = new Map<string, number>();
  lines.forEach((line, index) =>
    positions.set(line, positions.has(line) ? -1 : index),
  );
  return positions;
}

function lineOffsets(lines: string[]) {
  const offsets = [0];
  for (const line of lines) offsets.push(offsets.at(-1)! + line.length);
  return offsets;
}

function mergeSpans(spans: Span[]) {
  const merged: Span[] = [];
  for (const span of spans.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end)
      previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

function removeSpans(source: string, spans: Span[]): ProjectedText {
  const retained: string[] = [];
  const parts: string[] = [];
  let position = 0;
  for (const span of spans) {
    const content = source.slice(position, span.start);
    retained.push(content);
    parts.push(content, overlapMarker);
    position = span.end;
  }
  retained.push(source.slice(position));
  parts.push(source.slice(position));
  return { content: parts.join(""), retained: retained.filter(Boolean) };
}
