// Independent TypeScript grammar, not the harness's projection implementation.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repo } from "./campaign-paths.mjs";
const ts = createRequire(join(repo, "packages/agent-runtime/package.json"))("typescript");
export const normalizedHeader = text => text.trim().replace(/^export\s+(?:default\s+)?/u, "")
  .replace(/\s+/gu, " ").replace(/\s*([<>,():?\[\]])\s*/gu, "$1");
export async function expectedInventory(root, targets) {
  const functions = [];
  for (const { path, name } of targets) {
    const text = await readFile(join(root, path), "utf8"),
      source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), matches = [];
    const visit = node => {
      if (ts.isFunctionDeclaration(node) && node.body && node.name?.text === name) matches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (source.parseDiagnostics.length || matches.length !== 1) throw Error("Invalid or ambiguous inventory declaration");
    const node = matches[0];
    functions.push({ path, name, signature: text.slice(node.getStart(source), node.body.getStart(source)).trim() });
  }
  return { functions };
}
export function matchesInventory(expected, actual) {
  return actual && Object.keys(actual).length === 1 && Array.isArray(actual.functions)
    && actual.functions.length === expected.functions.length && actual.functions.every((entry, index) => {
      const wanted = expected.functions[index];
      return entry && Object.keys(entry).length === 3 && entry.path === wanted.path && entry.name === wanted.name
        && typeof entry.signature === "string" && normalizedHeader(entry.signature) === normalizedHeader(wanted.signature);
    });
}
