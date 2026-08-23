import type { RelationKind } from "./schemas.js";
import type { SymbolKind } from "./code-intelligence.js";

export type SemanticTarget = {
  digest: string;
  end: number;
  kind: SymbolKind;
  name: string;
  path: string;
  qualifiedName: string;
  start: number;
};

export type SemanticRelationRecord = {
  access?: "read" | "write";
  certainty: "may" | "must";
  excerpt: string;
  line_range: [number, number];
  path: string;
  range_utf8_bytes: [number, number];
  relation: RelationKind;
};

export type SemanticRelationIndex = {
  cacheHit: boolean;
  complete: boolean;
  engine: "typescript";
  engineVersion: string;
  indexRevisionId: string;
  items: SemanticRelationRecord[];
  projectKind: "configured" | "inferred";
};

export type SemanticRelationUnavailable = {
  reason:
    | "compiler_error"
    | "project_too_large"
    | "target_not_resolved"
    | "unsupported_language";
};

export type SemanticRelationResolution =
  | { available: true; index: SemanticRelationIndex }
  | { available: false; unavailable: SemanticRelationUnavailable };
