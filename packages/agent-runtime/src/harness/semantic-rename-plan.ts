import { resolve } from "node:path";
import ts from "typescript";
import { semanticReferenceLimits } from "./semantic-reference-types.js";

// Compiler edits remain in memory. This guard is not test or verification evidence.
export function compilerRenamePlan(
  service: ts.LanguageService,
  program: ts.Program,
  path: string,
  position: number,
  oldName: string,
  newName: string,
  read: (path: string) => string | undefined,
  eligible: (path: string) => boolean,
  overlay: (files: Map<string, string>) => void,
): readonly ts.RenameLocation[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    newName,
  );
  if (
    newName.length > 256 ||
    newName.includes("\\") ||
    scanner.scan() !== ts.SyntaxKind.Identifier ||
    scanner.getTokenText() !== newName ||
    scanner.scan() !== ts.SyntaxKind.EndOfFileToken ||
    newName === "constructor"
  )
    throw new Error("invalid_rename_identifier");
  const info = service.getRenameInfo(path, position, {
    allowRenameOfImportPath: false,
  });
  if (!info.canRename || info.fileToRename)
    throw new Error("unsupported_rename_target");
  if (oldName === newName) return [];
  const locations = service.findRenameLocations(path, position, false, false, {
    providePrefixAndSuffixTextForRename: true,
    allowRenameOfImportPath: false,
  });
  if (
    !locations?.length ||
    locations.length > semanticReferenceLimits.locations
  )
    throw new Error("rename_location_budget_or_target_unavailable");
  if (locations.some((entry) => !eligible(entry.fileName)))
    throw new Error("rename_outside_workspace");
  const byFile = new Map<string, ts.RenameLocation[]>();
  for (const entry of locations) {
    const key = resolve(entry.fileName),
      entries = byFile.get(key) ?? [];
    if (
      !entries.some(
        (other) =>
          other.textSpan.start === entry.textSpan.start &&
          other.textSpan.length === entry.textSpan.length,
      )
    )
      entries.push(entry);
    byFile.set(key, entries);
  }
  if (byFile.size > 50) throw new Error("rename_file_budget_exceeded");
  const checker = program.getTypeChecker();
  const canonical = (symbol: ts.Symbol | undefined) =>
    symbol &&
    (symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol);
  const before = new Map<string, Map<string, number>>();
  const changed = new Map<string, string>();
  const diagnostics = (file: string, normalize: boolean) => {
    const counts = new Map<string, number>();
    for (const diagnostic of [
      ...service.getSyntacticDiagnostics(file),
      ...service.getSemanticDiagnostics(file),
    ]) {
      let message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      if (normalize) message = message.split(newName).join(oldName);
      const key = `${diagnostic.code}:${message}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  for (const [file, entries] of byFile) {
    const source = program.getSourceFile(file),
      original = read(file);
    if (!source || original === undefined)
      throw new Error("rename_source_unavailable");
    for (const entry of entries) {
      let token: ts.Node | undefined;
      const visit = (node: ts.Node) => {
        if (
          node.getStart(source) > entry.textSpan.start ||
          node.getEnd() < entry.textSpan.start + entry.textSpan.length
        )
          return;
        if (
          ts.isIdentifier(node) &&
          node.getStart(source) === entry.textSpan.start
        )
          token = node;
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (!token) throw new Error("unsupported_rename_location");
      const parent = token.parent;
      // An explicitly aliased import changes its foreign binding, not its local alias.
      if (ts.isImportSpecifier(parent) && parent.propertyName === token)
        continue;
      const existing =
        ts.isPropertyAccessExpression(parent) && parent.name === token
          ? checker.getTypeAtLocation(parent.expression).getProperty(newName)
          : checker.resolveName(newName, token, ts.SymbolFlags.All, false);
      if (
        existing &&
        canonical(existing) !== canonical(checker.getSymbolAtLocation(token))
      )
        throw new Error("rename_name_capture");
      if (ts.isClassElement(parent) || ts.isTypeElement(parent)) {
        const container = parent.parent as
          | ts.ClassLikeDeclaration
          | ts.InterfaceDeclaration
          | ts.TypeLiteralNode;
        if (
          container.members?.some(
            (member) =>
              member !== parent &&
              member.name &&
              ts.isIdentifier(member.name) &&
              member.name.text === newName,
          )
        )
          throw new Error("rename_member_collision");
      }
    }
    before.set(file, diagnostics(file, false));
    let content = original,
      boundary = original.length;
    for (const entry of [...entries].sort(
      (a, b) => b.textSpan.start - a.textSpan.start,
    )) {
      const { start, length } = entry.textSpan;
      if (start + length > boundary)
        throw new Error("overlapping_rename_locations");
      content =
        content.slice(0, start) +
        (entry.prefixText ?? "") +
        newName +
        (entry.suffixText ?? "") +
        content.slice(start + length);
      boundary = start;
    }
    changed.set(file, content);
  }
  overlay(changed);
  for (const file of byFile.keys())
    for (const [key, count] of diagnostics(file, true))
      if (count > (before.get(file)!.get(key) ?? 0))
        throw new Error("rename_introduces_diagnostics");
  return [...byFile.values()].flat();
}
