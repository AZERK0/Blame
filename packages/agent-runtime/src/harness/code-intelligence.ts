import { Lang, parse, type SgNode } from "@ast-grep/napi";
import type { SymbolRef, SyntaxNodeRef } from "./protocol.js";
import { encodeHandle, sha256 } from "./protocol.js";

export type SymbolKind =
  | "class"
  | "enum"
  | "function"
  | "interface"
  | "method"
  | "type"
  | "variable";

export type CodeSymbol = {
  kind: SymbolKind;
  name: string;
  qualified_name: string;
  signature: string;
  visibility?: string;
  range_utf8_bytes: [number, number];
  line_range: [number, number];
  symbol_ref: SymbolRef;
  node_ref: SyntaxNodeRef;
};

type ParsedSymbol = Omit<CodeSymbol, "symbol_ref" | "node_ref"> & {
  node: SgNode;
};

export type ParseResult = {
  language: string;
  supported: boolean;
  symbols: ParsedSymbol[];
  errorCount: number;
  root?: SgNode;
};

export function parseCode(path: string, content: Buffer): ParseResult {
  const language = parserLanguage(path);
  if (!language)
    return {
      language: "unknown",
      supported: false,
      symbols: [],
      errorCount: 0,
    };
  const source = content.toString("utf8");
  try {
    const root = parse(language.lang, source).root();
    const symbols: ParsedSymbol[] = [];
    collectSymbols(root, content, [], symbols);
    return {
      language: language.name,
      supported: true,
      symbols,
      errorCount: countErrorNodes(root),
      root,
    };
  } catch {
    return {
      language: language.name,
      supported: false,
      symbols: [],
      errorCount: 1,
    };
  }
}

export function materializeSymbol(input: {
  symbol: ParsedSymbol;
  path: string;
  revision: string;
  blobHash: string;
  language: string;
  content: Buffer;
}): CodeSymbol {
  const { symbol } = input;
  const [start, end] = symbol.range_utf8_bytes;
  const bytes = input.content.subarray(start, end);
  const digest = sha256(bytes);
  const handle = {
    version: 1 as const,
    revision: input.revision,
    path: input.path,
    start,
    end,
    digest,
    kind: symbol.kind,
    language: input.language,
    qualifiedName: symbol.qualified_name,
  };
  return {
    ...withoutNode(symbol),
    symbol_ref: {
      ref: encodeHandle("sym", handle),
      source_revision_id: input.revision,
      definition_digest: sha256(
        `${symbol.kind}\0${symbol.qualified_name}\0${symbol.signature}\0${digest}`,
      ),
      kind: symbol.kind,
      language: input.language,
      qualified_name: symbol.qualified_name,
    },
    node_ref: {
      ref: encodeHandle("node", handle),
      source_revision_id: input.revision,
      file_blob_hash: input.blobHash,
      range_utf8_bytes: [start, end],
      node_digest: digest,
    },
  };
}

export function inspectParsedNode(input: {
  content: Buffer;
  node: SgNode;
  view: "body" | "declaration" | "interface" | "neighborhood" | "signature";
}) {
  const nodeRange = byteRange(input.node);
  const body = bodyNode(input.node);
  if (input.view === "neighborhood") {
    const [start, end] = neighborhoodRange(input.content, nodeRange, 8);
    return {
      content: input.content.subarray(start, end).toString("utf8"),
      range_utf8_bytes: [start, end] as [number, number],
    };
  }
  if (input.view === "body" && body) {
    const range = byteRange(body);
    return {
      content: input.content.subarray(...range).toString("utf8"),
      range_utf8_bytes: range,
    };
  }
  if (input.view === "declaration" || input.view === "interface") {
    const end = body ? byteRange(body)[0] : nodeRange[1];
    return {
      content: input.content
        .subarray(nodeRange[0], end)
        .toString("utf8")
        .trimEnd(),
      range_utf8_bytes: [nodeRange[0], end] as [number, number],
    };
  }
  const content = signature(input.node, input.content);
  return { content, range_utf8_bytes: nodeRange };
}

export function findExactNode(
  parsed: ParseResult,
  content: Buffer,
  start: number,
  end: number,
  digest: string,
) {
  if (!parsed.root) return undefined;
  const candidates: SgNode[] = [];
  walk(parsed.root, (node) => {
    const range = byteRange(node);
    if (range[0] === start && range[1] === end) candidates.push(node);
  });
  return candidates.find(
    (node) => sha256(content.subarray(start, end)) === digest && node.isNamed(),
  );
}

export function structuralMatches(
  path: string,
  content: Buffer,
  pattern: string,
  maxResults: number,
) {
  const language = parserLanguage(path);
  if (!language) return undefined;
  const root = parse(language.lang, content.toString("utf8")).root();
  const matches = root.findAll(pattern).slice(0, maxResults);
  return {
    language: language.name,
    matches: matches.map((node) => ({
      kind: String(node.kind()),
      range_utf8_bytes: byteRange(node),
      line_range: lineRange(node),
      text: compact(node.text(), 240),
    })),
  };
}

function collectSymbols(
  node: SgNode,
  source: Buffer,
  containers: string[],
  output: ParsedSymbol[],
) {
  const symbol = symbolFromNode(node, source, containers);
  const nextContainers = symbol ? [...containers, symbol.name] : containers;
  if (symbol) output.push(symbol);
  for (const child of node.children())
    collectSymbols(child, source, nextContainers, output);
}

function symbolFromNode(
  node: SgNode,
  source: Buffer,
  containers: string[],
): ParsedSymbol | undefined {
  const kind = symbolKind(node);
  if (!kind) return undefined;
  const name = symbolName(node, kind);
  if (!name) return undefined;
  return {
    kind,
    name,
    qualified_name: [...containers, name].join("."),
    signature: signature(node, source),
    ...(visibility(node) ? { visibility: visibility(node) } : {}),
    range_utf8_bytes: byteRange(node),
    line_range: lineRange(node),
    node,
  };
}

function symbolKind(node: SgNode): SymbolKind | undefined {
  switch (node.kind()) {
    case "class_declaration":
    case "abstract_class_declaration":
      return "class";
    case "function_declaration":
    case "generator_function_declaration":
      return "function";
    case "method_definition":
    case "method_signature":
    case "abstract_method_signature":
      return "method";
    case "interface_declaration":
      return "interface";
    case "type_alias_declaration":
      return "type";
    case "enum_declaration":
      return "enum";
    case "variable_declarator":
      return isFunctionVariable(node) ? "variable" : undefined;
    default:
      return undefined;
  }
}

function symbolName(node: SgNode, kind: SymbolKind) {
  const named = fieldNode(node, "name")?.text().trim();
  if (named) return named;
  if (kind === "variable") return node.child(0)?.text().trim();
  return node
    .children()
    .find((child) => /identifier$/.test(String(child.kind())))
    ?.text()
    .trim();
}

function isFunctionVariable(node: SgNode) {
  const value = fieldNode(node, "value");
  return (
    value?.kind() === "arrow_function" ||
    value?.kind() === "function_expression"
  );
}

function signature(node: SgNode, source: Buffer) {
  const body = bodyNode(node);
  if (!body) return compact(node.text(), 500);
  const nodeStart = node.range().start.index;
  const bodyStart = body.range().start.index;
  const prefix = source.subarray(nodeStart, bodyStart).toString("utf8");
  return compact(prefix.trimEnd(), 500);
}

function bodyNode(node: SgNode) {
  const direct = fieldNode(node, "body");
  if (direct) return direct;
  const value = fieldNode(node, "value");
  return value ? (fieldNode(value, "body") ?? value) : undefined;
}

function fieldNode(node: SgNode, name: string): SgNode | undefined {
  try {
    return node.field(name as never) ?? undefined;
  } catch {
    return undefined;
  }
}

function visibility(node: SgNode) {
  const prefix = node.text().slice(0, 80);
  if (/\bprivate\b/.test(prefix)) return "private";
  if (/\bprotected\b/.test(prefix)) return "protected";
  if (/\bpublic\b/.test(prefix)) return "public";
  if (
    node.ancestors().some((ancestor) => ancestor.kind() === "export_statement")
  )
    return "exported";
  return undefined;
}

function parserLanguage(path: string) {
  const extension = path.toLowerCase().match(/\.[^.]+$/)?.[0];
  switch (extension) {
    case ".ts":
      return { lang: Lang.TypeScript, name: "typescript" };
    case ".tsx":
    case ".jsx":
      return {
        lang: Lang.Tsx,
        name: extension === ".jsx" ? "javascript" : "typescript",
      };
    case ".js":
    case ".mjs":
    case ".cjs":
      return { lang: Lang.JavaScript, name: "javascript" };
    case ".css":
      return { lang: Lang.Css, name: "css" };
    case ".html":
    case ".htm":
      return { lang: Lang.Html, name: "html" };
    default:
      return undefined;
  }
}

function countErrorNodes(root: SgNode) {
  let count = 0;
  walk(root, (node) => {
    if (node.kind() === "ERROR" || node.kind() === "MISSING") count += 1;
  });
  return count;
}

function walk(node: SgNode, visit: (node: SgNode) => void) {
  visit(node);
  for (const child of node.children()) walk(child, visit);
}

function byteRange(node: SgNode): [number, number] {
  return [node.range().start.index, node.range().end.index];
}

function lineRange(node: SgNode): [number, number] {
  return [node.range().start.line + 1, node.range().end.line + 1];
}

function neighborhoodRange(
  content: Buffer,
  range: [number, number],
  contextLines: number,
): [number, number] {
  let start = range[0];
  let end = range[1];
  for (let line = 0; line < contextLines && start > 0; line += 1) {
    start = content.lastIndexOf(10, Math.max(0, start - 2));
    if (start < 0) {
      start = 0;
      break;
    }
  }
  for (let line = 0; line < contextLines && end < content.length; line += 1) {
    const next = content.indexOf(10, end);
    if (next < 0) {
      end = content.length;
      break;
    }
    end = next + 1;
  }
  return [start, end];
}

function withoutNode(symbol: ParsedSymbol): Omit<ParsedSymbol, "node"> {
  const { node, ...serializable } = symbol;
  void node;
  return serializable;
}

function compact(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}
