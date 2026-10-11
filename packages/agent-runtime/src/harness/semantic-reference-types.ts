export type SemanticReferenceRequest = {
  root: string;
  renameTo?: string;
  target: {
    path: string;
    name: string;
    start: number;
    end: number;
    hash: string;
  };
};

export type SemanticReferenceLocation = {
  path: string;
  range: [number, number];
  lines: [number, number];
  snippet: string;
  isWrite: boolean;
  replacement?: string;
};

export type ReferenceFootprint = {
  reads: Array<{ path: string; hash: string }>;
  existence: Array<{ path: string; exists: boolean }>;
};

export type SemanticReferenceReply =
  | { status: "unavailable"; reason: string }
  | {
      status: "ok";
      locations: SemanticReferenceLocation[];
      footprint: ReferenceFootprint;
      project: {
        config: string;
        rootFiles: number;
        loadedFiles: number;
        compilerVersion: string;
        scope: "configured_project";
        warnings: string[];
      };
    };

export const semanticReferenceLimits = {
  timeoutMs: 8_000,
  renameTimeoutMs: 12_000,
  workerHeapMb: 512,
  rootFiles: 2_000,
  observedFiles: 6_000,
  observedExistence: 30_000,
  observedBytes: 64 * 1024 * 1024,
  locations: 10_000,
} as const;
