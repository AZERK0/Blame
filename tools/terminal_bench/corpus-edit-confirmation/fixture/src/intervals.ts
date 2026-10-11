export type Range = readonly [number, number];

export function mergeRanges(ranges: readonly Range[]): Range[] {
  return [...ranges];
}
