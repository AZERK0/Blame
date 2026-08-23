import { relative, resolve } from "node:path";
import ts from "typescript";
import { SemanticRelationCache } from "./semantic-relation-cache.js";
import type {
  SemanticRelationIndex,
  SemanticRelationRecord,
  SemanticRelationResolution,
  SemanticTarget,
} from "./semantic-relations.js";
import {
  typescriptSemanticProject,
  type TypeScriptSemanticProject,
} from "./typescript-semantic-project.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

type CompilerLocation = {
  fileName: string;
  isDefinition?: boolean;
  isWriteAccess?: boolean;
  textSpan: ts.TextSpan;
};

export class TypeScriptSemanticService {
  private readonly cache: SemanticRelationCache;
  private readonly files: WorkspaceFiles;

  constructor(files: WorkspaceFiles) {
    this.cache = new SemanticRelationCache(files.root);
    this.files = files;
  }

  async relations(input: {
    signal?: AbortSignal;
    snapshot: WorkspaceSnapshot;
    target: SemanticTarget;
  }): Promise<SemanticRelationResolution> {
    if (!supportsTypeScriptSemantics(input.target.path))
      return unavailable("unsupported_language");
    try {
      input.signal?.throwIfAborted();
      const cached = await this.cache.read({
        engineVersion: ts.version,
        sourceRevisionId: input.snapshot.revision.source_revision_id,
        target: input.target,
      });
      if (cached) return { available: true, index: cached };
      return await this.buildRelations(input);
    } catch {
      input.signal?.throwIfAborted();
      return unavailable("compiler_error");
    }
  }

  private async buildRelations(input: {
    signal?: AbortSignal;
    snapshot: WorkspaceSnapshot;
    target: SemanticTarget;
  }): Promise<SemanticRelationResolution> {
    const project = typescriptSemanticProject({
      root: this.files.root,
      snapshot: input.snapshot,
      targetPath: input.target.path,
    });
    if (project === "project_too_large")
      return unavailable("project_too_large");
    if (!project) return unavailable("target_not_resolved");
    const position = targetPosition(
      project.program,
      this.files.root,
      input.target,
    );
    if (position === undefined) return unavailable("target_not_resolved");
    input.signal?.throwIfAborted();
    const built = buildRelationIndex(
      project,
      this.files.root,
      input.target,
      position,
    );
    await this.ensureRevision(input.snapshot, input.signal);
    await this.persist(input, built);
    return { available: true, index: built };
  }

  private async ensureRevision(
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    const current = await this.files.snapshot(signal);
    if (
      current.revision.source_revision_id !==
      snapshot.revision.source_revision_id
    ) {
      throw new Error(`STALE_REVISION:${current.revision.source_revision_id}`);
    }
  }

  private async persist(
    input: { snapshot: WorkspaceSnapshot; target: SemanticTarget },
    index: SemanticRelationIndex,
  ) {
    try {
      await this.cache.write({
        index,
        sourceRevisionId: input.snapshot.revision.source_revision_id,
        target: input.target,
      });
    } catch {
      return;
    }
  }
}

function buildRelationIndex(
  project: TypeScriptSemanticProject,
  root: string,
  target: SemanticTarget,
  position: number,
): SemanticRelationIndex {
  const targetFile = resolve(root, target.path);
  const items = compilerRelations(project, root, target, targetFile, position);
  const deduplicated = deduplicateRelations(items).sort(compareRelations);
  return {
    cacheHit: false,
    complete: deduplicated.length <= maximumIndexedRelations,
    engine: "typescript",
    engineVersion: ts.version,
    indexRevisionId: project.indexRevisionId,
    items: deduplicated.slice(0, maximumIndexedRelations),
    projectKind: project.kind,
  };
}

function compilerRelations(
  project: TypeScriptSemanticProject,
  root: string,
  target: SemanticTarget,
  targetFile: string,
  position: number,
) {
  const references = project.service.findReferences(targetFile, position) ?? [];
  const implementations =
    project.service.getImplementationAtPosition(targetFile, position) ?? [];
  return [
    ...references.flatMap((group) =>
      group.references.flatMap((entry) =>
        recordsForLocation(project.program, root, target, entry),
      ),
    ),
    ...implementations.flatMap((entry) =>
      recordsForLocation(project.program, root, target, entry, "implements"),
    ),
  ];
}

function recordsForLocation(
  program: ts.Program,
  root: string,
  target: SemanticTarget,
  location: CompilerLocation,
  forcedRelation?: SemanticRelationRecord["relation"],
) {
  if (location.isDefinition) return [];
  const path = workspacePath(root, location.fileName);
  const sourceFile = program.getSourceFile(location.fileName);
  if (!path || !sourceFile) return [];
  if (targetLocation(path, sourceFile, location.textSpan, target)) return [];
  const primary = forcedRelation ?? classifyRelation(sourceFile, location);
  return [
    relationRecord(
      sourceFile,
      path,
      location.textSpan,
      primary,
      target,
      accessKind(primary, location),
    ),
  ];
}

function relationRecord(
  sourceFile: ts.SourceFile,
  path: string,
  span: ts.TextSpan,
  relation: SemanticRelationRecord["relation"],
  target: SemanticTarget,
  access?: SemanticRelationRecord["access"],
): SemanticRelationRecord {
  const text = sourceFile.text;
  const end = span.start + span.length;
  const startLine = sourceFile.getLineAndCharacterOfPosition(span.start).line;
  const endLine = sourceFile.getLineAndCharacterOfPosition(end).line;
  return {
    ...(access ? { access } : {}),
    certainty: relationCertainty(relation, target.kind),
    excerpt: lineExcerpt(sourceFile, startLine),
    line_range: [startLine + 1, endLine + 1],
    path,
    range_utf8_bytes: [byteOffset(text, span.start), byteOffset(text, end)],
    relation,
  };
}

function classifyRelation(
  sourceFile: ts.SourceFile,
  location: CompilerLocation,
): SemanticRelationRecord["relation"] {
  const path = sourceFile.fileName.replaceAll("\\", "/");
  if (isTestPath(path)) return "tested_by";
  const node = nodeAtPosition(sourceFile, location.textSpan.start);
  if (hasAncestor(node, isImportNode)) return "imports";
  if (hasAncestor(node, ts.isHeritageClause)) return "implements";
  if (hasCallAncestor(node)) return "calls";
  return "references";
}

function accessKind(
  primary: SemanticRelationRecord["relation"],
  location: CompilerLocation,
) {
  if (["implements", "imports", "tested_by"].includes(primary))
    return undefined;
  return location.isWriteAccess ? ("write" as const) : ("read" as const);
}

function targetPosition(
  program: ts.Program,
  root: string,
  target: SemanticTarget,
) {
  const sourceFile = program.getSourceFile(resolve(root, target.path));
  if (!sourceFile) return undefined;
  const content = Buffer.from(sourceFile.text);
  const start = content.subarray(0, target.start).toString("utf8").length;
  const end = content.subarray(0, target.end).toString("utf8").length;
  return bestTargetName(sourceFile, target.name, start, end)?.getStart(
    sourceFile,
  );
}

function bestTargetName(
  sourceFile: ts.SourceFile,
  name: string,
  start: number,
  end: number,
) {
  let best: { node: ts.Node; score: number } | undefined;
  const visit = (node: ts.Node) => {
    if (node.end < start || node.getStart(sourceFile) > end) return;
    if (nodeName(node) === name && declarationName(node)) {
      const parent = node.parent;
      const score =
        Math.abs(parent.getStart(sourceFile) - start) +
        Math.abs(parent.end - end);
      if (!best || score < best.score) best = { node, score };
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return best?.node;
}

function declarationName(node: ts.Node) {
  const parent = node.parent as ts.Node & { name?: ts.Node };
  return parent.name === node;
}

function nodeName(node: ts.Node) {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

function nodeAtPosition(sourceFile: ts.SourceFile, position: number) {
  let match: ts.Node = sourceFile;
  const visit = (node: ts.Node) => {
    if (node.getStart(sourceFile) > position || node.end < position) return;
    match = node;
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return match;
}

function hasAncestor(
  node: ts.Node,
  predicate: (candidate: ts.Node) => boolean,
) {
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  )
    if (predicate(current)) return true;
  return false;
}

function hasCallAncestor(node: ts.Node) {
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  ) {
    if (ts.isCallExpression(current) || ts.isNewExpression(current))
      return containsNode(current.expression, node);
    if (ts.isTaggedTemplateExpression(current))
      return containsNode(current.tag, node);
  }
  return false;
}

function containsNode(container: ts.Node, node: ts.Node) {
  return node.pos >= container.pos && node.end <= container.end;
}

function isImportNode(node: ts.Node) {
  return (
    ts.isImportDeclaration(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node)
  );
}

function workspacePath(root: string, fileName: string) {
  const path = relative(root, fileName).replaceAll("\\", "/");
  return path && path !== ".." && !path.startsWith("../") ? path : undefined;
}

function targetLocation(
  path: string,
  sourceFile: ts.SourceFile,
  span: ts.TextSpan,
  target: SemanticTarget,
) {
  if (path !== target.path) return false;
  const start = byteOffset(sourceFile.text, span.start);
  const end = byteOffset(sourceFile.text, span.start + span.length);
  return start >= target.start && end <= target.end;
}

function lineExcerpt(sourceFile: ts.SourceFile, line: number) {
  const start = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const next = sourceFile.text.indexOf("\n", start);
  const end = next < 0 ? sourceFile.text.length : next;
  const value = sourceFile.text.slice(start, end).trim();
  return value.length > 300 ? `${value.slice(0, 299)}…` : value;
}

function byteOffset(value: string, characterOffset: number) {
  return Buffer.byteLength(value.slice(0, characterOffset));
}

function relationCertainty(
  relation: SemanticRelationRecord["relation"],
  targetKind: string,
) {
  if (relation !== "calls") return "must" as const;
  return ["interface", "method", "property"].includes(targetKind)
    ? ("may" as const)
    : ("must" as const);
}

function deduplicateRelations(items: SemanticRelationRecord[]) {
  return [
    ...new Map(
      items.map((item) => [
        `${item.relation}\0${item.path}\0${item.range_utf8_bytes.join(":")}`,
        item,
      ]),
    ).values(),
  ];
}

function compareRelations(
  left: SemanticRelationRecord,
  right: SemanticRelationRecord,
) {
  return (
    relationPriority[left.relation] - relationPriority[right.relation] ||
    left.path.localeCompare(right.path) ||
    left.range_utf8_bytes[0] - right.range_utf8_bytes[0]
  );
}

function isTestPath(path: string) {
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|\.)|\.(?:spec|test)\.[^/]+$/iu.test(
    path,
  );
}

function supportsTypeScriptSemantics(path: string) {
  return /\.(?:[cm]?[jt]sx?|d\.ts)$/iu.test(path);
}

function unavailable(
  reason: Extract<
    SemanticRelationResolution,
    { available: false }
  >["unavailable"]["reason"],
): SemanticRelationResolution {
  return { available: false, unavailable: { reason } };
}

const maximumIndexedRelations = 2_000;
const relationPriority: Record<SemanticRelationRecord["relation"], number> = {
  calls: 0,
  implements: 1,
  imports: 2,
  tested_by: 3,
  writes: 4,
  reads: 5,
  references: 6,
};
