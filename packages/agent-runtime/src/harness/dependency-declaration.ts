import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { assertMutableWorkspacePath } from "./workspace-files.js";
import type {
  DependencyDeclarationReply,
  DependencyDeclarationRequest,
} from "./semantic-reference-types.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const inside = (root: string, path: string) => {
  const value = relative(root, path);
  return value !== ".." && !value.startsWith("../") && !value.startsWith("..\\") && !isAbsolute(value);
};
const portable = (path: string) => path.split("\\").join("/");
const maxPageBytes = 12_000;
const maxDeclarationBytes = 256_000;
const maxDeclarations = 16;

/** Compiler identity only. This projection never registers writable aliases. */
export function dependencyDeclaration(
  program: ts.Program,
  source: ts.SourceFile,
  request: DependencyDeclarationRequest,
  host: ts.ParseConfigFileHost,
): Extract<DependencyDeclarationReply, { status: "ok" }>["declaration"] {
  const [binding, ...members] = request.target.name.split(".");
  if (!binding || members.some((name) => !name)) throw new Error("import_binding_required");
  const imports: ts.Identifier[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name?.text === binding) imports.push(clause.name);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named) && named.name.text === binding) imports.push(named.name);
      if (named && ts.isNamedImports(named))
        for (const specifier of named.elements)
          if (specifier.name.text === binding) imports.push(specifier.name);
    } else if (ts.isImportEqualsDeclaration(statement) && statement.name.text === binding)
      imports.push(statement.name);
  }
  if (imports.length !== 1) throw new Error(imports.length ? "ambiguous_import_binding" : "import_binding_not_found");
  const checker = program.getTypeChecker();
  const unalias = (symbol: ts.Symbol | undefined) =>
    symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  let symbol = unalias(checker.getSymbolAtLocation(imports[0]!));
  for (const member of members) {
    if (!symbol) break;
    const exported = checker.getExportsOfModule(symbol).find((entry) => entry.name === member);
    symbol = unalias(exported ?? checker.getPropertyOfType(checker.getTypeOfSymbolAtLocation(symbol, imports[0]!), member)
      ?? checker.getPropertyOfType(checker.getDeclaredTypeOfSymbol(symbol), member));
  }
  if (!symbol?.declarations?.length) throw new Error("unresolved_import_declaration");
  const namespace = symbol.declarations.every(ts.isSourceFile);
  const declarations = [...new Set(symbol.declarations)];
  if (declarations.length > maxDeclarations) throw new Error("declaration_count_budget_exceeded");
  // Only node_modules directories reachable from this consumer inside the
  // workspace are trusted installation roots. pnpm and shared node_modules
  // symlinks work; an individual package symlink outside them does not.
  const roots: string[] = [];
  for (let directory = dirname(source.fileName); inside(request.root, directory); directory = dirname(directory)) {
    try { roots.push(host.realpath!(resolve(directory, "node_modules"))); } catch { /* absent installation */ }
    if (resolve(directory) === resolve(request.root)) break;
  }
  const sources: Extract<DependencyDeclarationReply, { status: "ok" }>["declaration"]["sources"] = [];
  const sections: string[] = [];
  let total = 0;
  for (const declaration of declarations) {
    const file = declaration.getSourceFile();
    if (!file.isDeclarationFile || !/\.d\.[cm]?ts$/iu.test(file.fileName))
      throw new Error("installed_type_declaration_required");
    const path = host.realpath!(file.fileName);
    if (!roots.some((root) => inside(root, path))) throw new Error("declaration_outside_installation");
    const segments = portable(path).split("/");
    if (segments.some((part) => [".git", ".ssh"].includes(part.toLowerCase())))
      throw new Error("protected_declaration_path");
    const nm = segments.lastIndexOf("node_modules");
    if (nm < 0) throw new Error("unidentified_dependency_package");
    const count = segments[nm + 1]?.startsWith("@") ? 2 : 1;
    const packageRoot = segments.slice(0, nm + 1 + count).join("/");
    const packageName = segments.slice(nm + 1, nm + 1 + count).join("/");
    const packagePath = resolve(packageRoot, "package.json");
    if (!inside(packageRoot, host.realpath!(packagePath)))
      throw new Error("dependency_package_metadata_escape");
    const packageText = host.readFile(packagePath);
    if (!packageText) throw new Error("dependency_package_metadata_missing");
    const metadata: unknown = JSON.parse(packageText);
    if (!metadata || typeof metadata !== "object" || !("name" in metadata) || metadata.name !== packageName ||
      !("version" in metadata) || typeof metadata.version !== "string" || metadata.version.length > 100)
      throw new Error("dependency_package_identity_mismatch");
    const subpath = portable(relative(packageRoot, path));
    assertMutableWorkspacePath(subpath);
    // Read through the footprint host too: program text must match the bytes
    // whose hash is returned and later checked by the client.
    const text = host.readFile(path);
    if (text !== file.text) throw new Error("declaration_changed");
    const start = namespace ? 0 : declaration.getFullStart();
    const end = namespace ? 0 : declaration.getEnd();
    const lines: [number, number] = [file.getLineAndCharacterOfPosition(start).line + 1,
      file.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1];
    sources.push({ package: packageName, version: metadata.version, path: subpath,
      hash: digest(text), packageHash: digest(packageText), lines });
    if (!namespace) {
      const section = `// ${packageName}@${metadata.version}/${subpath}:${lines[0]}\n${text.slice(start, end).trim()}\n`;
      total += Buffer.byteLength(section);
      if (total > maxDeclarationBytes) throw new Error("declaration_byte_budget_exceeded");
      sections.push(section);
    }
  }
  const listing = Buffer.from(sections.join("\n"));
  const offset = request.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > listing.length ||
    offset < listing.length && (listing[offset]! & 0xc0) === 0x80)
    throw new Error("invalid_declaration_offset");
  let end = Math.min(listing.length, offset + maxPageBytes);
  while (end < listing.length && (listing[end]! & 0xc0) === 0x80) end--;
  const allExports = namespace ? checker.getExportsOfModule(symbol).map((entry) => entry.name).sort() : undefined;
  let exportBytes = 0;
  const exported = allExports?.filter((name) => {
    exportBytes += Buffer.byteLength(name);
    return exportBytes <= 2_048 && name.length <= 128;
  }).slice(0, 64);
  return {
    readOnly: true, content: listing.subarray(offset, end).toString("utf8"),
    offset, totalBytes: listing.length, sources,
    ...(end < listing.length ? { nextOffset: end } : {}),
    ...(exported ? { exports: exported, exportsTruncated: exported.length !== allExports!.length } : {}),
  };
}
