// Grammar-aware nontrivia token audit; never queries the language service or
// retrieves a reference solution. Template interpolation requires parser context.
import { createRequire } from "node:module";
const ts = createRequire(new URL("../../../packages/agent-runtime/package.json", import.meta.url))("typescript");
export function identifierTokens(text, oldName, newName, rename = false) {
  const source = ts.createSourceFile("audit.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error("Invalid audit source syntax");
  function visit(node) {
    if (node.kind === ts.SyntaxKind.EndOfFileToken ||
        (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)) return [];
    const children = node.getChildren(source);
    if (children.length) return children.flatMap(visit);
    const value = node.getText(source);
    return [[node.kind, rename && node.kind === ts.SyntaxKind.Identifier && value === oldName ? newName : value]];
  }
  return visit(source);
}
export function onlyIdentifierRename(before, after, oldName, newName) {
  return JSON.stringify(identifierTokens(before, oldName, newName, true)) ===
    JSON.stringify(identifierTokens(after, oldName, newName));
}
export const compilerVersion = ts.version;
