import type { SgNode } from "@ast-grep/napi";
import { parseCode } from "./code-intelligence.js";

export type CssDeclarationEdit =
  | {
      operation: "insert";
      property: string;
      value: string;
      afterProperty?: string;
    }
  | { operation: "remove"; property: string }
  | { operation: "set"; property: string; value: string };

type Declaration = {
  end: number;
  node: SgNode;
  property: string;
  propertyEnd: number;
  start: number;
  valueEnd: number;
  valueStart: number;
};

export function editCssDeclaration(source: string, edit: CssDeclarationEdit) {
  const parsed = parseCode("rule.css", Buffer.from(source));
  const rule = parsed.symbols.find((symbol) => symbol.kind === "css_rule");
  if (!rule)
    throw new Error("UNSUPPORTED_STRUCTURE:CSS rule cannot be parsed.");
  const block = rule.node.children().find((child) => child.kind() === "block");
  if (!block)
    throw new Error("UNSUPPORTED_STRUCTURE:CSS rule has no declaration block.");
  const declarations = block.children().flatMap(declarationRecord);
  if (edit.operation === "set")
    return setDeclaration(source, declarations, edit);
  if (edit.operation === "remove")
    return removeDeclarations(source, declarations, edit.property);
  return insertDeclaration(source, block, declarations, edit);
}

function declarationRecord(node: SgNode): Declaration[] {
  if (node.kind() !== "declaration") return [];
  const property = node
    .children()
    .find((child) => child.kind() === "property_name");
  const colon = node.children().find((child) => child.kind() === ":");
  const terminator = [...node.children()]
    .reverse()
    .find((child) => child.kind() === ";");
  if (!property || !colon) return [];
  return [
    {
      end: node.range().end.index,
      node,
      property: property.text().trim(),
      propertyEnd: property.range().end.index,
      start: node.range().start.index,
      valueEnd: terminator?.range().start.index ?? node.range().end.index,
      valueStart: colon.range().end.index,
    },
  ];
}

function setDeclaration(
  source: string,
  declarations: Declaration[],
  edit: Extract<CssDeclarationEdit, { operation: "set" }>,
) {
  const declaration = declarations
    .filter((item) => item.property === edit.property)
    .at(-1);
  if (!declaration)
    return insertDeclaration(
      source,
      ruleBlock(source, declarations),
      declarations,
      {
        operation: "insert",
        property: edit.property,
        value: edit.value,
      },
    );
  const current = source.slice(declaration.valueStart, declaration.valueEnd);
  const leading = current.match(/^\s*/u)?.[0] ?? "";
  const trailing = current.match(/\s*$/u)?.[0] ?? "";
  return replaceRange(
    source,
    [declaration.valueStart, declaration.valueEnd],
    `${leading}${edit.value}${trailing}`,
  );
}

function removeDeclarations(
  source: string,
  declarations: Declaration[],
  property: string,
) {
  const ranges = declarations
    .filter((declaration) => declaration.property === property)
    .map((declaration) => declarationLineRange(source, declaration));
  return ranges
    .sort((left, right) => right[0] - left[0])
    .reduce((content, range) => replaceRange(content, range, ""), source);
}

function insertDeclaration(
  source: string,
  block: SgNode,
  declarations: Declaration[],
  edit: Extract<CssDeclarationEdit, { operation: "insert" }>,
) {
  const anchor = edit.afterProperty
    ? declarations.filter((item) => item.property === edit.afterProperty).at(-1)
    : undefined;
  const indent = declarationIndent(source, declarations, block);
  const declaration = `${indent}${edit.property}: ${edit.value};`;
  if (anchor) {
    const end = lineEnd(source, anchor.end);
    const prefix = source.slice(anchor.end, end).includes("\n") ? "" : "\n";
    return replaceRange(source, [end, end], `${prefix}${declaration}\n`);
  }
  const closing = block.range().end.index - 1;
  const closingStart = lineStart(source, closing);
  const closingPrefix = source.slice(closingStart, closing);
  if (!closingPrefix.trim())
    return replaceRange(
      source,
      [closingStart, closing],
      `${declaration}\n${closingPrefix}`,
    );
  return replaceRange(
    source,
    [closing, closing],
    `\n${declaration}\n${closingIndent(source, closing)}`,
  );
}

function ruleBlock(source: string, declarations: Declaration[]) {
  const parsed = parseCode("rule.css", Buffer.from(source));
  const rule = parsed.symbols.find((symbol) => symbol.kind === "css_rule");
  const block = rule?.node.children().find((child) => child.kind() === "block");
  if (!block)
    throw new Error("UNSUPPORTED_STRUCTURE:CSS rule has no declaration block.");
  void declarations;
  return block;
}

function declarationLineRange(
  source: string,
  declaration: Declaration,
): [number, number] {
  const start = lineStart(source, declaration.start);
  const prefix = source.slice(start, declaration.start);
  if (prefix.trim()) return [declaration.start, declaration.end];
  return [start, lineEnd(source, declaration.end)];
}

function declarationIndent(
  source: string,
  declarations: Declaration[],
  block: SgNode,
) {
  const declaration = declarations[0];
  if (declaration)
    return source.slice(
      lineStart(source, declaration.start),
      declaration.start,
    );
  return `${closingIndent(source, block.range().end.index - 1)}  `;
}

function closingIndent(source: string, closing: number) {
  return (
    source.slice(lineStart(source, closing), closing).match(/^\s*/u)?.[0] ?? ""
  );
}

function lineStart(source: string, offset: number) {
  return source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function lineEnd(source: string, offset: number) {
  const next = source.indexOf("\n", offset);
  return next < 0 ? source.length : next + 1;
}

function replaceRange(
  source: string,
  [start, end]: [number, number],
  replacement: string,
) {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}
