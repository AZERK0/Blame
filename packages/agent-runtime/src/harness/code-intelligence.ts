import bashLanguage from "@ast-grep/lang-bash";
import csharpLanguage from "@ast-grep/lang-csharp";
import goLanguage from "@ast-grep/lang-go";
import javaLanguage from "@ast-grep/lang-java";
import pythonLanguage from "@ast-grep/lang-python";
import rustLanguage from "@ast-grep/lang-rust";
import {
  Lang,
  parse,
  registerDynamicLanguage,
  type SgNode,
} from "@ast-grep/napi";
import { packagedResourcePath } from "./packaged-resource-path.js";
import { encodeHandle, sha256 } from "./protocol.js";
import {
  languageCapability,
  type SemanticParserId,
} from "./language-capabilities.js";

let dynamicLanguagesRegistered = false;

export type SymbolKind =
  | "class"
  | "constructor"
  | "enum"
  | "function"
  | "interface"
  | "method"
  | "module"
  | "namespace"
  | "property"
  | "struct"
  | "trait"
  | "type"
  | "variable"
  | "css_rule"
  | "css_media"
  | "css_keyframes"
  | "css_custom_property";

export type CodeSymbol = {
  kind: SymbolKind;
  name: string;
  qualified_name: string;
  signature: string;
  visibility?: string;
  range_utf8_bytes: [number, number];
  line_range: [number, number];
  symbol_ref: string;
};

export type OutlineSymbol = Pick<
  CodeSymbol,
  "kind" | "line_range" | "name" | "qualified_name" | "symbol_ref"
> & {
  signature?: string;
  visibility?: string;
};

export type ParsedTree = {
  byteOffset: number;
  lineOffset: number;
  root: SgNode;
};

export type ParsedNode = ParsedTree & { node: SgNode };

export type ParsedSymbol = Omit<CodeSymbol, "symbol_ref"> & ParsedNode;

type CurrentNodeCandidate = {
  kind: string;
  line_range: [number, number];
  node_ref: string;
  range_utf8_bytes: [number, number];
};

export type EnclosingNode = CurrentNodeCandidate & { text: string };

export type ParseResult = {
  language: string;
  supported: boolean;
  symbols: ParsedSymbol[];
  errorCount: number;
  trees: ParsedTree[];
};

type LanguageSpec = {
  lang: Lang | string;
  name: string;
};

type SourceUnit = ParsedTree & {
  source: string;
};

const maximumCachedParses = 64;
const parseCache = new Map<string, ParseResult>();

export function parseCode(path: string, content: Buffer): ParseResult {
  const cacheKey = `${extension(path)}\0${sha256(content)}`;
  const cached = parseCache.get(cacheKey);
  if (cached) {
    parseCache.delete(cacheKey);
    parseCache.set(cacheKey, cached);
    return cached;
  }
  const parsed = parseCodeUncached(path, content);
  parseCache.set(cacheKey, parsed);
  trimParseCache();
  return parsed;
}

export function syntaxBoundaryRange(
  path: string,
  content: Buffer,
  target: [number, number],
): [number, number] {
  const parsed = parseCode(path, content);
  const candidate = parsed.trees
    .map((tree) => boundaryCandidate(tree, target))
    .filter((value): value is ParsedNode => Boolean(value))
    .sort((left, right) => nodeSize(left) - nodeSize(right))[0];
  if (!candidate) return target;
  const node = outerInsertionNode(candidate.node);
  return byteRange(node, candidate.byteOffset);
}

function boundaryCandidate(
  tree: ParsedTree,
  target: [number, number],
): ParsedNode | undefined {
  let selected: SgNode | undefined;
  walk(tree.root, (node) => {
    const range = byteRange(node, tree.byteOffset);
    if (range[0] > target[0] || range[1] < target[1]) return;
    if (!selected || node.text().length < selected.text().length)
      selected = node;
  });
  return selected ? { ...tree, node: selected } : undefined;
}

function outerInsertionNode(initial: SgNode) {
  let node = initial;
  for (let parent = node.parent(); parent; parent = node.parent()) {
    if (isSyntaxContainer(String(parent.kind()))) break;
    node = parent;
  }
  return node;
}

function isSyntaxContainer(kind: string) {
  return (
    syntaxContainerKinds.has(kind) || /(?:^|_)(?:body|block|list)$/u.test(kind)
  );
}

function nodeSize(node: ParsedNode) {
  const range = byteRange(node.node, node.byteOffset);
  return range[1] - range[0];
}

const syntaxContainerKinds = new Set([
  "arguments",
  "array",
  "document",
  "formal_parameters",
  "jsx_element",
  "module",
  "object",
  "program",
  "source_file",
  "stylesheet",
]);

export function materializeSymbol(input: {
  symbol: ParsedSymbol;
  path: string;
  revision: string;
  content: Buffer;
  neighborNames?: string[];
  ordinal?: number;
}): CodeSymbol {
  const { symbol } = input;
  const [start, end] = symbol.range_utf8_bytes;
  const handle = encodeHandle("sym", {
    version: 2,
    revision: input.revision,
    path: input.path,
    start,
    end,
    digest: sha256(input.content.subarray(start, end)).slice(0, 32),
    observedBlobHash: sha256(input.content).slice(0, 32),
    kind: symbol.kind,
    language: languageName(input.path),
    qualifiedName: symbol.qualified_name,
    signatureDigest: sha256(normalizedSignature(symbol.signature)).slice(0, 16),
    bodyFingerprint: bodyFingerprint(symbol, input.content),
    ancestryFingerprint: ancestryFingerprint(symbol.qualified_name),
    ...(input.neighborNames?.length
      ? {
          neighborFingerprint: sha256(input.neighborNames.join("\0")).slice(
            0,
            16,
          ),
        }
      : {}),
    ...(input.ordinal === undefined ? {} : { ordinal: input.ordinal }),
  });
  const { byteOffset, lineOffset, node, root, ...publicSymbol } = symbol;
  void byteOffset;
  void lineOffset;
  void node;
  void root;
  return { ...publicSymbol, symbol_ref: handle };
}

export function symbolEditRange(
  symbol: ParsedSymbol,
  view: "body" | "signature" | "symbol",
) {
  const range = byteRange(symbol.node, symbol.byteOffset);
  if (view === "symbol") return range;
  const body = bodyNode(symbol.node);
  if (view === "body") return body ? byteRange(body, symbol.byteOffset) : range;
  return [
    range[0],
    body ? byteRange(body, symbol.byteOffset)[0] : range[1],
  ] as [number, number];
}

export function outlineSymbol(
  symbol: CodeSymbol,
  include: Array<"signature" | "visibility"> = ["signature"],
): OutlineSymbol {
  return {
    kind: symbol.kind,
    name: symbol.name,
    qualified_name: symbol.qualified_name,
    line_range: symbol.line_range,
    symbol_ref: symbol.symbol_ref,
    ...(include.includes("signature") ? { signature: symbol.signature } : {}),
    ...(include.includes("visibility") && symbol.visibility
      ? { visibility: symbol.visibility }
      : {}),
  };
}

export function inspectParsedNode(input: {
  content: Buffer;
  parsed: ParsedNode;
  view: "body" | "declaration" | "interface" | "neighborhood" | "signature";
}) {
  const nodeRange = byteRange(input.parsed.node, input.parsed.byteOffset);
  if (input.view === "neighborhood")
    return inspectedRange(
      input.content,
      neighborhoodRange(input.content, nodeRange, 8),
    );
  const body = bodyNode(input.parsed.node);
  if (input.view === "body" && body)
    return inspectedRange(
      input.content,
      byteRange(body, input.parsed.byteOffset),
    );
  if (["declaration", "interface", "signature"].includes(input.view)) {
    const end = body
      ? byteRange(body, input.parsed.byteOffset)[0]
      : nodeRange[1];
    return inspectedRange(input.content, [nodeRange[0], end], true);
  }
  return inspectedRange(input.content, nodeRange);
}

export function findExactNode(
  parsed: ParseResult,
  content: Buffer,
  start: number,
  end: number,
  digest: string,
): ParsedNode | undefined {
  if (!sha256(content.subarray(start, end)).startsWith(digest))
    return undefined;
  for (const tree of parsed.trees) {
    let match: SgNode | undefined;
    walk(tree.root, (node) => {
      const range = byteRange(node, tree.byteOffset);
      if (range[0] === start && range[1] === end && node.isNamed())
        match = node;
    });
    if (match) return { ...tree, node: match };
  }
  return undefined;
}

export function smallestEnclosingNode(input: {
  content: Buffer;
  end: number;
  path: string;
  revision: string;
  start: number;
}): EnclosingNode | undefined {
  const parsed = parseCode(input.path, input.content);
  let selected: { kind: string; range: [number, number] } | undefined;
  for (const tree of parsed.trees)
    walk(tree.root, (node) => {
      if (!node.isNamed()) return;
      const range = byteRange(node, tree.byteOffset);
      if (range[0] > input.start || range[1] < input.end) return;
      if (
        !selected ||
        range[1] - range[0] < selected.range[1] - selected.range[0]
      )
        selected = { kind: String(node.kind()), range };
    });
  if (!selected) return undefined;
  return materializeEnclosingNode(input, selected);
}

function materializeEnclosingNode(
  input: Parameters<typeof smallestEnclosingNode>[0],
  selected: { kind: string; range: [number, number] },
): EnclosingNode {
  const fragment = input.content.subarray(...selected.range);
  return {
    kind: selected.kind,
    line_range: byteLineRange(input.content, selected.range),
    node_ref: encodeHandle("node", {
      version: 2,
      revision: input.revision,
      path: input.path,
      start: selected.range[0],
      end: selected.range[1],
      digest: sha256(fragment).slice(0, 32),
      observedBlobHash: sha256(input.content).slice(0, 32),
      kind: selected.kind,
      language: languageName(input.path),
    }),
    range_utf8_bytes: selected.range,
    text: fragment.toString("utf8"),
  };
}

export function structuralMatches(
  path: string,
  content: Buffer,
  pattern: string,
  maxResults: number,
) {
  const units = sourceUnits(path, content.toString("utf8"));
  if (!units) return undefined;
  const matches = units.flatMap((unit) =>
    unit.root.findAll(pattern).map((node) => structuralMatch(node, unit)),
  );
  return {
    language: languageName(path),
    matches: matches.slice(0, maxResults),
  };
}

export function currentSymbolCandidates(input: {
  content: Buffer;
  kind?: string;
  path: string;
  qualifiedName?: string;
  revision: string;
  signatureDigest?: string;
}) {
  return parseCode(input.path, input.content)
    .symbols.filter((symbol) => !input.kind || symbol.kind === input.kind)
    .filter(
      (symbol) =>
        !input.qualifiedName || symbol.qualified_name === input.qualifiedName,
    )
    .map((symbol) => ({
      symbol,
      materialized: materializeSymbol({
        symbol,
        path: input.path,
        revision: input.revision,
        content: input.content,
      }),
      signatureMatches:
        !input.signatureDigest ||
        sha256(normalizedSignature(symbol.signature)).startsWith(
          input.signatureDigest,
        ),
    }));
}

export function currentNodeCandidates(input: {
  content: Buffer;
  digest: string;
  kind?: string;
  path: string;
  revision: string;
}) {
  const parsed = parseCode(input.path, input.content);
  const candidates: CurrentNodeCandidate[] = [];
  for (const tree of parsed.trees)
    collectNodeCandidates(input, tree, candidates);
  return candidates;
}

function collectNodeCandidates(
  input: Parameters<typeof currentNodeCandidates>[0],
  tree: ParsedTree,
  candidates: CurrentNodeCandidate[],
) {
  walk(tree.root, (node) => {
    if (!node.isNamed()) return;
    const kind = String(node.kind());
    if (input.kind && kind !== input.kind) return;
    const range = byteRange(node, tree.byteOffset);
    if (!sha256(input.content.subarray(...range)).startsWith(input.digest))
      return;
    candidates.push({
      kind,
      line_range: lineRange(node, tree.lineOffset),
      node_ref: encodeNodeCandidate(input, kind, range),
      range_utf8_bytes: range,
    });
  });
}

function encodeNodeCandidate(
  input: Parameters<typeof currentNodeCandidates>[0],
  kind: string,
  range: [number, number],
) {
  return encodeHandle("node", {
    version: 2,
    revision: input.revision,
    path: input.path,
    start: range[0],
    end: range[1],
    digest: input.digest,
    observedBlobHash: sha256(input.content).slice(0, 32),
    kind,
    language: languageName(input.path),
  });
}

function parseCodeUncached(path: string, content: Buffer): ParseResult {
  const language = languageName(path);
  try {
    const units = sourceUnits(path, content.toString("utf8"));
    if (!units) return unsupportedParse();
    const symbols: ParsedSymbol[] = [];
    for (const unit of units)
      collectSymbols(unit.root, content, unit, [], symbols);
    return {
      language,
      supported: true,
      symbols,
      errorCount: units.reduce(
        (count, unit) => count + countErrorNodes(unit.root),
        0,
      ),
      trees: units,
    };
  } catch {
    return {
      language,
      supported: false,
      symbols: [],
      errorCount: 1,
      trees: [],
    };
  }
}

function unsupportedParse(): ParseResult {
  return {
    language: "unknown",
    supported: false,
    symbols: [],
    errorCount: 0,
    trees: [],
  };
}

function sourceUnits(path: string, source: string): SourceUnit[] | undefined {
  if (extension(path) === ".vue") return vueSourceUnits(source);
  const language = directLanguage(path);
  if (!language) return undefined;
  return [parseSourceUnit(language, source, 0, 0)];
}

function vueSourceUnits(source: string) {
  const units: SourceUnit[] = [];
  const expression = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
  for (const match of source.matchAll(expression)) {
    const content = match[2] ?? "";
    const contentIndex = (match.index ?? 0) + (match[0].indexOf(">") + 1);
    const prefix = source.slice(0, contentIndex);
    const language = /\blang\s*=\s*["'](?:ts|tsx)["']/iu.test(match[1] ?? "")
      ? { lang: Lang.TypeScript, name: "vue" }
      : { lang: Lang.JavaScript, name: "vue" };
    units.push(
      parseSourceUnit(
        language,
        content,
        Buffer.byteLength(prefix),
        lineCount(prefix) - 1,
      ),
    );
  }
  return units;
}

function parseSourceUnit(
  language: LanguageSpec,
  source: string,
  byteOffset: number,
  lineOffset: number,
): SourceUnit {
  ensureDynamicLanguages(language.lang);
  return {
    byteOffset,
    lineOffset,
    root: parse(language.lang, source).root(),
    source,
  };
}

function ensureDynamicLanguages(language: Lang | string) {
  if (dynamicLanguagesRegistered || !dynamicLanguageNames.has(String(language)))
    return;
  registerDynamicLanguage({
    bash: loadableLanguage(bashLanguage),
    csharp: loadableLanguage(csharpLanguage),
    go: loadableLanguage(goLanguage),
    java: loadableLanguage(javaLanguage),
    python: loadableLanguage(pythonLanguage),
    rust: loadableLanguage(rustLanguage),
  });
  dynamicLanguagesRegistered = true;
}

function loadableLanguage(language: typeof bashLanguage) {
  return {
    ...language,
    libraryPath: packagedResourcePath(language.libraryPath),
  };
}

function collectSymbols(
  node: SgNode,
  source: Buffer,
  tree: ParsedTree,
  containers: string[],
  output: ParsedSymbol[],
) {
  const symbol = symbolFromNode(node, source, tree, containers);
  const nextContainers = symbol ? [...containers, symbol.name] : containers;
  if (symbol) output.push(symbol);
  for (const child of node.children())
    collectSymbols(child, source, tree, nextContainers, output);
}

function symbolFromNode(
  node: SgNode,
  source: Buffer,
  tree: ParsedTree,
  containers: string[],
): ParsedSymbol | undefined {
  const kind = symbolKind(node);
  if (!kind) return undefined;
  const name = symbolName(node, kind);
  if (!name) return undefined;
  return {
    ...tree,
    node,
    kind,
    name,
    qualified_name: qualifiedName(kind, containers, name),
    signature: signature(node, source, tree.byteOffset),
    ...(visibility(node) ? { visibility: visibility(node) } : {}),
    range_utf8_bytes: byteRange(node, tree.byteOffset),
    line_range: lineRange(node, tree.lineOffset),
  };
}

function symbolKind(node: SgNode): SymbolKind | undefined {
  if (node.kind() === "rule_set") return "css_rule";
  if (node.kind() === "media_statement") return "css_media";
  if (node.kind() === "keyframes_statement") return "css_keyframes";
  if (
    node.kind() === "declaration" &&
    node
      .children()
      .find((child) => child.kind() === "property_name")
      ?.text()
      .startsWith("--")
  )
    return "css_custom_property";
  if (node.kind() === "variable_declarator")
    return isRelevantVariable(node) ? "variable" : undefined;
  if (node.kind() === "function_definition")
    return hasAncestor(node, "class_definition") ? "method" : "function";
  if (node.kind() === "function_item")
    return hasAncestor(node, "impl_item") ? "method" : "function";
  if (node.kind() === "type_spec") return goTypeKind(node);
  return symbolKindByNode[node.kind()];
}

function goTypeKind(node: SgNode): SymbolKind {
  const type = fieldNode(node, "type")?.kind();
  if (type === "struct_type") return "struct";
  if (type === "interface_type") return "interface";
  return "type";
}

function symbolName(node: SgNode, kind: SymbolKind) {
  if (kind.startsWith("css_")) return cssSymbolName(node, kind);
  const named = fieldNode(node, "name")?.text().trim();
  if (named) return named;
  if (kind === "variable") return node.child(0)?.text().trim();
  return node
    .children()
    .find((child) => /(?:identifier|name)$/u.test(String(child.kind())))
    ?.text()
    .trim();
}

function isRelevantVariable(node: SgNode) {
  if (isFunctionVariable(node)) return true;
  return node
    .ancestors()
    .every((ancestor) => !functionLikeKinds.has(String(ancestor.kind())));
}

function isFunctionVariable(node: SgNode) {
  const value = fieldNode(node, "value");
  return (
    value?.kind() === "arrow_function" ||
    value?.kind() === "function_expression"
  );
}

function signature(node: SgNode, source: Buffer, byteOffset: number) {
  const range = byteRange(node, byteOffset);
  const body = bodyNode(node);
  const end = body ? byteRange(body, byteOffset)[0] : range[1];
  return compact(
    source.subarray(range[0], end).toString("utf8").trimEnd(),
    500,
  );
}

function bodyNode(node: SgNode) {
  const direct = fieldNode(node, "body");
  if (direct) return direct;
  const value = fieldNode(node, "value");
  if (value) return fieldNode(value, "body") ?? value;
  return node
    .children()
    .find((child) =>
      ["block", "keyframe_block_list"].includes(String(child.kind())),
    );
}

function qualifiedName(kind: SymbolKind, containers: string[], name: string) {
  const separator = kind.startsWith("css_") ? "::" : ".";
  return [...containers, name].join(separator);
}

export function normalizedSignature(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function fieldNode(node: SgNode, name: string): SgNode | undefined {
  try {
    return node.field(name as never) ?? undefined;
  } catch {
    return undefined;
  }
}

function visibility(node: SgNode) {
  const prefix = node.text().slice(0, 100);
  if (/\bprivate\b/u.test(prefix)) return "private";
  if (/\bprotected\b/u.test(prefix)) return "protected";
  if (/\bpublic\b/u.test(prefix)) return "public";
  if (/\bpub(?:\([^)]*\))?\b/u.test(prefix)) return "exported";
  if (hasAncestor(node, "export_statement")) return "exported";
  return undefined;
}

function cssSymbolName(node: SgNode, kind: SymbolKind) {
  if (kind === "css_rule") return namedChildText(node, "selectors");
  if (kind === "css_media") {
    const query = namedChildText(node, "feature_query");
    return query ? `@media${query}` : "@media";
  }
  if (kind === "css_keyframes") {
    const name = namedChildText(node, "keyframes_name");
    return name ? `@keyframes(${name})` : "@keyframes";
  }
  return namedChildText(node, "property_name");
}

function namedChildText(node: SgNode, kind: string) {
  return node
    .children()
    .find((child) => child.kind() === kind)
    ?.text()
    .trim();
}

function directLanguage(path: string): LanguageSpec | undefined {
  const parserId = languageCapability(path).parserId;
  if (!parserId || parserId === "vue") return undefined;
  return languageByParserId[parserId];
}

export function semanticLanguageName(path: string) {
  const capability = languageCapability(path);
  return capability.level === "plain_text" || capability.level === "unsupported"
    ? "unknown"
    : capability.languageId;
}

function languageName(path: string) {
  return semanticLanguageName(path);
}

function bodyFingerprint(symbol: ParsedSymbol, content: Buffer) {
  const body = bodyNode(symbol.node);
  if (!body) return undefined;
  return sha256(content.subarray(...byteRange(body, symbol.byteOffset))).slice(
    0,
    16,
  );
}

function ancestryFingerprint(qualifiedName: string) {
  const parts = qualifiedName.split(/\.|::/u);
  parts.pop();
  return sha256(parts.join("\0")).slice(0, 12);
}

function extension(path: string) {
  return path.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
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

function byteRange(node: SgNode, byteOffset = 0): [number, number] {
  return [
    byteOffset + node.range().start.index,
    byteOffset + node.range().end.index,
  ];
}

function lineRange(node: SgNode, lineOffset = 0): [number, number] {
  return [
    lineOffset + node.range().start.line + 1,
    lineOffset + node.range().end.line + 1,
  ];
}

function byteLineRange(
  content: Buffer,
  range: [number, number],
): [number, number] {
  const start = content
    .subarray(0, range[0])
    .toString("utf8")
    .split("\n").length;
  const lines = content
    .subarray(...range)
    .toString("utf8")
    .split("\n").length;
  return [start, start + Math.max(0, lines - 1)];
}

function structuralMatch(node: SgNode, unit: SourceUnit) {
  return {
    kind: String(node.kind()),
    range_utf8_bytes: byteRange(node, unit.byteOffset),
    line_range: lineRange(node, unit.lineOffset),
    text: compact(node.text(), 240),
  };
}

function inspectedRange(
  content: Buffer,
  range: [number, number],
  trimEnd = false,
) {
  const value = content.subarray(...range).toString("utf8");
  return {
    content: trimEnd ? value.trimEnd() : value,
    range_utf8_bytes: range,
  };
}

function neighborhoodRange(
  content: Buffer,
  range: [number, number],
  contextLines: number,
): [number, number] {
  return [
    previousLinesStart(content, range[0], contextLines),
    nextLinesEnd(content, range[1], contextLines),
  ];
}

function previousLinesStart(content: Buffer, initial: number, count: number) {
  let start = initial;
  for (let line = 0; line < count && start > 0; line += 1) {
    start = content.lastIndexOf(10, Math.max(0, start - 2));
    if (start < 0) return 0;
  }
  return start;
}

function nextLinesEnd(content: Buffer, initial: number, count: number) {
  let end = initial;
  for (let line = 0; line < count && end < content.length; line += 1) {
    const next = content.indexOf(10, end);
    if (next < 0) return content.length;
    end = next + 1;
  }
  return end;
}

function hasAncestor(node: SgNode, kind: string) {
  return node.ancestors().some((ancestor) => ancestor.kind() === kind);
}

function lineCount(value: string) {
  return value.split("\n").length;
}

function trimParseCache() {
  while (parseCache.size > maximumCachedParses) {
    const oldest = parseCache.keys().next().value;
    if (typeof oldest !== "string") return;
    parseCache.delete(oldest);
  }
}

function compact(value: string, maximum: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

const functionLikeKinds = new Set([
  "arrow_function",
  "function_declaration",
  "function_definition",
  "function_expression",
  "function_item",
  "method_declaration",
  "method_definition",
]);

const symbolKindByNode: Record<string, SymbolKind> = {
  abstract_class_declaration: "class",
  abstract_method_signature: "method",
  class_definition: "class",
  class_declaration: "class",
  constructor_declaration: "constructor",
  enum_declaration: "enum",
  enum_item: "enum",
  file_scoped_namespace_declaration: "namespace",
  function_declaration: "function",
  generator_function_declaration: "function",
  interface_declaration: "interface",
  method_declaration: "method",
  method_definition: "method",
  method_signature: "method",
  mod_item: "module",
  module_declaration: "module",
  namespace_declaration: "namespace",
  property_declaration: "property",
  record_declaration: "class",
  struct_declaration: "struct",
  struct_item: "struct",
  trait_item: "trait",
  type_alias_declaration: "type",
};

const languageByParserId: Record<
  Exclude<SemanticParserId, "vue">,
  LanguageSpec
> = {
  bash: { lang: "bash", name: "bash" },
  csharp: { lang: "csharp", name: "csharp" },
  css: { lang: Lang.Css, name: "css" },
  go: { lang: "go", name: "go" },
  html: { lang: Lang.Html, name: "html" },
  java: { lang: "java", name: "java" },
  javascript: { lang: Lang.JavaScript, name: "javascript" },
  python: { lang: "python", name: "python" },
  rust: { lang: "rust", name: "rust" },
  tsx: { lang: Lang.Tsx, name: "typescript" },
  typescript: { lang: Lang.TypeScript, name: "typescript" },
};

const dynamicLanguageNames = new Set([
  "bash",
  "csharp",
  "go",
  "java",
  "python",
  "rust",
]);
