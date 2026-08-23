import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";
import type {
  SemanticRelationIndex,
  SemanticRelationRecord,
  SemanticTarget,
} from "./semantic-relations.js";

type CachedRelations = Omit<SemanticRelationIndex, "cacheHit" | "engine"> & {
  engine: "typescript";
  schemaVersion: 1;
  sourceRevisionId: string;
  targetKey: string;
};

export class SemanticRelationCache {
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = join(
      workspaceRoot,
      ".blame",
      "harness",
      "semantic-index",
      "typescript",
    );
  }

  async read(input: {
    engineVersion: string;
    sourceRevisionId: string;
    target: SemanticTarget;
  }): Promise<SemanticRelationIndex | undefined> {
    try {
      const path = this.path(input);
      const value = JSON.parse(await readFile(path, "utf8"));
      if (!isCachedRelations(value, input)) return undefined;
      return {
        cacheHit: true,
        complete: value.complete,
        engine: value.engine,
        engineVersion: value.engineVersion,
        indexRevisionId: value.indexRevisionId,
        items: value.items,
        projectKind: value.projectKind,
      };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      return undefined;
    }
  }

  async write(input: {
    index: SemanticRelationIndex;
    sourceRevisionId: string;
    target: SemanticTarget;
  }) {
    const directory = this.revisionDirectory(input.sourceRevisionId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const { cacheHit, ...persistedIndex } = input.index;
    void cacheHit;
    const value: CachedRelations = {
      ...persistedIndex,
      engine: "typescript",
      schemaVersion: 1,
      sourceRevisionId: input.sourceRevisionId,
      targetKey: targetKey(input.target),
    };
    await writeFileAtomic(this.path(input), JSON.stringify(value), {
      fsync: true,
      mode: 0o600,
    });
    await pruneRevisionDirectories(this.root, input.sourceRevisionId);
  }

  private path(input: { sourceRevisionId: string; target: SemanticTarget }) {
    return join(
      this.revisionDirectory(input.sourceRevisionId),
      `${sha256(targetKey(input.target))}.json`,
    );
  }

  private revisionDirectory(sourceRevisionId: string) {
    return join(this.root, sourceRevisionId);
  }
}

function isCachedRelations(
  value: unknown,
  expected: {
    engineVersion: string;
    sourceRevisionId: string;
    target: SemanticTarget;
  },
): value is CachedRelations {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<CachedRelations>;
  return (
    cache.schemaVersion === 1 &&
    cache.engine === "typescript" &&
    cache.engineVersion === expected.engineVersion &&
    cache.sourceRevisionId === expected.sourceRevisionId &&
    cache.targetKey === targetKey(expected.target) &&
    typeof cache.complete === "boolean" &&
    typeof cache.indexRevisionId === "string" &&
    /^idx_[a-f0-9]{32}$/u.test(cache.indexRevisionId) &&
    ["configured", "inferred"].includes(cache.projectKind ?? "") &&
    Array.isArray(cache.items) &&
    cache.items.length <= maximumCachedRelations &&
    cache.items.every(isSemanticRelationRecord)
  );
}

function isSemanticRelationRecord(
  value: unknown,
): value is SemanticRelationRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SemanticRelationRecord>;
  return (
    relationKinds.has(item.relation ?? "references") &&
    (item.access === undefined || ["read", "write"].includes(item.access)) &&
    ["may", "must"].includes(item.certainty ?? "") &&
    typeof item.path === "string" &&
    safeRelativePath(item.path) &&
    typeof item.excerpt === "string" &&
    item.excerpt.length <= 500 &&
    validRange(item.range_utf8_bytes) &&
    validRange(item.line_range, 1)
  );
}

function validRange(value: unknown, minimum = 0): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => Number.isSafeInteger(item) && item >= minimum) &&
    value[1] >= value[0]
  );
}

function safeRelativePath(path: string) {
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..")
  );
}

function targetKey(target: SemanticTarget) {
  return JSON.stringify([
    target.path,
    target.start,
    target.end,
    target.digest,
    target.kind,
    target.name,
  ]);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function pruneRevisionDirectories(root: string, current: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== current &&
        /^src_[a-f0-9]{32}$/u.test(entry.name),
    )
    .map((entry) => entry.name);
  if (candidates.length < maximumCachedRevisions) return;
  const dated = await Promise.all(
    candidates.map(async (name) => ({
      modified: (await stat(join(root, name))).mtimeMs,
      name,
    })),
  );
  const excess = dated.length - maximumCachedRevisions + 1;
  const expired = dated
    .sort((left, right) => left.modified - right.modified)
    .slice(0, excess);
  for (const entry of expired)
    await rm(join(root, entry.name), { force: true, recursive: true });
}

const maximumCachedRelations = 2_000;
const maximumCachedRevisions = 8;
const relationKinds = new Set([
  "calls",
  "implements",
  "imports",
  "reads",
  "references",
  "tested_by",
  "writes",
]);
