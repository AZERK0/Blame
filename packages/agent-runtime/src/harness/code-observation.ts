import { sha256 } from "./light-identity.js";

/** All intervals are half-open UTF-8 byte offsets, never JavaScript string offsets. */
export type CodeObservation = {
  path: string;
  sourceVersion: string;
  intervals: Array<{ start: number; end: number }>;
  completeness: "file" | "symbol" | "excerpt" | "outline";
  symbol?: {
    alias: string;
    qualifiedName: string;
    declarationFingerprint: string;
  };
  content: string;
};

export function codeObservation(
  path: string,
  source: Buffer,
  start: number,
  end: number,
  completeness: CodeObservation["completeness"],
  symbol?: { alias: string; qualifiedName: string },
): CodeObservation {
  if (
    start < 0 ||
    end < start ||
    end > source.length ||
    !Number.isInteger(start) ||
    !Number.isInteger(end)
  )
    throw new Error("Invalid source observation byte range.");
  const bytes = source.subarray(start, end);
  const content = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  return {
    path,
    sourceVersion: sha256(source),
    intervals: [{ start, end }],
    completeness,
    ...(symbol
      ? { symbol: { ...symbol, declarationFingerprint: sha256(bytes) } }
      : {}),
    content,
  };
}

export function presentObservation(observation: CodeObservation) {
  return {
    path: observation.path,
    completeness: observation.completeness,
    ...(observation.symbol
      ? {
          alias: observation.symbol.alias,
          qualifiedName: observation.symbol.qualifiedName,
          editHint: "Local patch or symbol replacement available.",
        }
      : {}),
    content: observation.content,
  };
}
