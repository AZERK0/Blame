// Private, zero-model binding oracle. Uses the upstream compiler, independently
// of the harness worker/compiler. Never copies a solution into an agent workspace.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { identifierTokens } from "../corpus/identifier-token-audit.mjs";
export function bindingOracle(root, task) {
  const ts = createRequire(join(root, "package.json"))("typescript");
  const config = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile);
  if (config.error) throw Error("Upstream compiler configuration failed");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw Error("Upstream compiler configuration failed");
  const host = ts.createCompilerHost(parsed.options), read = host.readFile.bind(host);
  host.readFile = path => task.inputFiles?.[path.slice(root.length + 1)] ?? read(path);
  const names = [...new Set([...parsed.fileNames, ...Object.keys(task.inputFiles ?? {}).map(path => join(root, path))])];
  const program = ts.createProgram(names, parsed.options, host), checker = program.getTypeChecker();
  const declaration = program.getSourceFile(join(root, task.declarationPath));
  const anchors = declaration.statements.filter(node => ts.isFunctionDeclaration(node) && node.body && node.name?.text === task.oldName);
  if (anchors.length !== 1) throw Error("Ambiguous/missing registered declaration");
  const anchor = checker.getSymbolAtLocation(anchors[0].name), spans = {};
  for (const source of program.getSourceFiles()) {
    const path = resolve(source.fileName).slice(root.length + 1);
    if (!resolve(source.fileName).startsWith(root + "/") || path.startsWith("node_modules/") || !source.text.includes(task.oldName)) continue;
    const locations = [];
    function visit(node) {
      if (ts.isIdentifier(node) && node.text === task.oldName) {
        const local = checker.getSymbolAtLocation(node);
        const target = local?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(local) : local;
        // Explicit local/public aliases keep their spelling, even if identical
        // to the original export name. Only the property side follows the export.
        const declaration = local?.declarations?.find(d => ts.isImportSpecifier(d) && d.propertyName);
        const keptLocal = declaration && node !== declaration.propertyName;
        const keptPublic = ts.isExportSpecifier(node.parent) && node.parent.propertyName && node === node.parent.name;
        if (target === anchor && !keptLocal && !keptPublic) locations.push([node.getStart(source), node.end]);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (locations.length) spans[path] = locations;
  }
  return { compilerVersion: ts.version, rootFiles: names.length, spans };
}
export function applyOracle(original, locations, newName) {
  for (const [start, end] of [...locations].sort((a, b) => b[0] - a[0]))
    original = original.slice(0, start) + newName + original.slice(end);
  return original;
}
function comments(text) {
  // Nontrivia token equivalence permits formatting; keep all comment spelling.
  const ts = createRequire(new URL("../../../packages/agent-runtime/package.json", import.meta.url))("typescript");
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text), result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan())
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) result.push(scanner.getTokenText());
  return result;
}
export async function auditMultifile(originalRoot, workspace, task) {
  const oracle = bindingOracle(originalRoot, task), checks = [];
  for (const path of task.allowedPaths) {
    const original = task.inputFiles?.[path] ?? await readFile(join(originalRoot, path), "utf8");
    const expected = applyOracle(original, oracle.spans[path] ?? [], task.newName);
    const actual = await readFile(join(workspace, path), "utf8");
    checks.push({ name: "binding-and-protected-tokens:" + path,
      passed: JSON.stringify(identifierTokens(expected)) === JSON.stringify(identifierTokens(actual)) &&
        JSON.stringify(comments(original)) === JSON.stringify(comments(actual)),
      resolvingLocations: oracle.spans[path]?.length ?? 0 });
  }
  checks.push({ name: "registered-cross-file-span-manifest", passed:
    JSON.stringify(oracle.spans) === JSON.stringify(task.oracle.spans) && oracle.compilerVersion === task.oracle.compilerVersion });
  return checks;
}
