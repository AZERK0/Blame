import {
  materializeSymbol,
  parseCode,
  semanticLanguageName,
  type CodeSymbol,
  type ParsedSymbol,
} from "./code-intelligence.js";
import { sha256 } from "./light-identity.js";
import type { WorkspaceFiles } from "./workspace-files.js";

type SymbolAlias = {
  alias: string;
  end: number;
  fileHash: string;
  kind: "symbol";
  language: string;
  path: string;
  qualifiedName: string;
  symbolKind: string;
  start: number;
};

type RangeAlias = {
  alias: string;
  end: number;
  fileHash: string;
  kind: "range";
  path: string;
  start: number;
};

export type LightAlias = SymbolAlias | RangeAlias;

export type ResolvedLightSymbol = {
  alias?: string;
  content: Buffer;
  materialized: CodeSymbol;
  path: string;
  symbol: ParsedSymbol;
};

export class SymbolResolutionError extends Error {
  readonly candidates: Array<{
    kind: string;
    line: number;
    qualifiedName: string;
  }>;

  constructor(
    message: string,
    candidates: SymbolResolutionError["candidates"] = [],
  ) {
    super(message);
    this.candidates = candidates;
  }
}

export class LightAliasRegistry {
  private readonly aliases = new Map<string, LightAlias>();
  private sequence = 0;

  registerSymbol(
    path: string,
    content: Buffer,
    symbol: ParsedSymbol,
    revision: string,
  ) {
    const materialized = materializeSymbol({ symbol, path, revision, content });
    const alias = this.nextAlias();
    this.aliases.set(alias, {
      alias,
      end: symbol.range_utf8_bytes[1],
      fileHash: sha256(content),
      kind: "symbol",
      language: semanticLanguageName(path),
      path,
      qualifiedName: symbol.qualified_name,
      symbolKind: symbol.kind,
      start: symbol.range_utf8_bytes[0],
    });
    return { alias, materialized };
  }

  registerRange(path: string, content: Buffer, range: [number, number]) {
    const alias = this.nextAlias();
    this.aliases.set(alias, {
      alias,
      end: range[1],
      fileHash: sha256(content),
      kind: "range",
      path,
      start: range[0],
    });
    return alias;
  }

  get(alias: string) {
    return this.aliases.get(alias);
  }

  entries() {
    return [...this.aliases.values()].map((entry) => ({ ...entry }));
  }

  hydrate(entries: LightAlias[]) {
    this.aliases.clear();
    for (const entry of entries) this.aliases.set(entry.alias, { ...entry });
    this.sequence = Math.max(0, ...entries.map(aliasSequence));
  }

  invalidatePath(path: string) {
    for (const [alias, entry] of this.aliases)
      if (entry.path === path) this.aliases.delete(alias);
  }

  async resolveSymbol(target: string, files: WorkspaceFiles, revision: string) {
    const entry = this.aliases.get(target);
    if (entry) return this.resolveAlias(entry, files, revision);
    return this.resolveQualifiedTarget(target, files, revision);
  }

  private async resolveAlias(
    entry: LightAlias,
    files: WorkspaceFiles,
    revision: string,
  ): Promise<ResolvedLightSymbol> {
    if (entry.kind !== "symbol")
      throw new SymbolResolutionError(
        `${entry.alias} is a text match, not a symbol.`,
      );
    const content = (await files.read(entry.path)).content;
    const parsed = parseCode(entry.path, content);
    const exact = sha256(content) === entry.fileHash;
    const candidates = parsed.symbols.filter((symbol) =>
      exact ? sameRange(symbol, entry) : sameIdentity(symbol, entry),
    );
    if (candidates.length !== 1)
      throw resolutionConflict(entry.qualifiedName, candidates);
    return resolved(entry.path, content, candidates[0]!, revision, entry.alias);
  }

  private async resolveQualifiedTarget(
    target: string,
    files: WorkspaceFiles,
    revision: string,
  ) {
    const separator = target.lastIndexOf("#");
    if (separator < 1 || separator === target.length - 1)
      throw new SymbolResolutionError(
        "Use a symbol alias or path#qualifiedName.",
      );
    const path = files.normalizePath(target.slice(0, separator));
    const qualifiedName = target.slice(separator + 1);
    const content = (await files.read(path)).content;
    const candidates = parseCode(path, content).symbols.filter(
      (symbol) => symbol.qualified_name === qualifiedName,
    );
    if (candidates.length !== 1)
      throw resolutionConflict(qualifiedName, candidates);
    return resolved(path, content, candidates[0]!, revision);
  }

  private nextAlias() {
    return `s${++this.sequence}`;
  }
}

function aliasSequence(entry: LightAlias) {
  const value = Number.parseInt(entry.alias.slice(1), 10);
  return Number.isFinite(value) ? value : 0;
}

function sameIdentity(symbol: ParsedSymbol, entry: SymbolAlias) {
  return (
    symbol.kind === entry.symbolKind &&
    symbol.qualified_name === entry.qualifiedName &&
    semanticLanguageName(entry.path) === entry.language
  );
}

function sameRange(symbol: ParsedSymbol, entry: SymbolAlias) {
  return (
    symbol.kind === entry.symbolKind &&
    symbol.range_utf8_bytes[0] === entry.start &&
    symbol.range_utf8_bytes[1] === entry.end
  );
}

function resolved(
  path: string,
  content: Buffer,
  symbol: ParsedSymbol,
  revision: string,
  alias?: string,
): ResolvedLightSymbol {
  return {
    ...(alias ? { alias } : {}),
    content,
    materialized: materializeSymbol({ symbol, path, revision, content }),
    path,
    symbol,
  };
}

function resolutionConflict(name: string, candidates: ParsedSymbol[]) {
  return new SymbolResolutionError(
    candidates.length
      ? `Symbol ${name} is ambiguous in its original file.`
      : `Symbol ${name} no longer exists in its original file.`,
    candidates.slice(0, 5).map((symbol) => ({
      kind: symbol.kind,
      line: symbol.line_range[0],
      qualifiedName: symbol.qualified_name,
    })),
  );
}
