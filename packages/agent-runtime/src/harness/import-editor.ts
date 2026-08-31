type ImportEdit = {
  from: string;
  names: string[];
  operation: "ensure_import" | "remove_import";
};

type ImportStatement = {
  end: number;
  module: string;
  start: number;
  text: string;
};

export type ImportTextEdit = {
  end: number;
  replacement: string;
  start: number;
};

export function editImports(source: string, edit: ImportEdit) {
  const change = importTextEdit(source, edit);
  return `${source.slice(0, change.start)}${change.replacement}${source.slice(change.end)}`;
}

export function importTextEdit(
  source: string,
  edit: ImportEdit,
): ImportTextEdit {
  const statements = importStatements(source);
  const matching = statements.find(
    (statement) => statement.module === edit.from,
  );
  if (edit.operation === "ensure_import")
    return ensureImportEdit(source, statements, matching, edit);
  return removeImportEdit(matching, edit.names);
}

function ensureImportEdit(
  source: string,
  statements: ImportStatement[],
  matching: ImportStatement | undefined,
  edit: ImportEdit,
) {
  if (matching && namedClause(matching.text)) {
    return replacementEdit(
      matching,
      replaceNamedClause(matching.text, edit.names, "add"),
    );
  }
  const statement = `import { ${sortedNames(edit.names).join(", ")} } from ${JSON.stringify(edit.from)};\n`;
  const offset = importInsertionOffset(source, statements, edit.from);
  return { start: offset, end: offset, replacement: statement };
}

function removeImportEdit(
  matching: ImportStatement | undefined,
  names: string[],
): ImportTextEdit {
  if (!matching) return emptyEdit();
  if (!names.length) return removalEdit(matching);
  if (!namedClause(matching.text)) return emptyEdit();
  const next = replaceNamedClause(matching.text, names, "remove");
  if (next) return replacementEdit(matching, next);
  const retained = withoutEmptyNamedClause(matching.text);
  return retained ? replacementEdit(matching, retained) : removalEdit(matching);
}

function importStatements(source: string) {
  const pattern =
    /(^|\n)([ \t]*import\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["'];?[ \t]*)(?=\n|$)/gu;
  const statements: ImportStatement[] = [];
  for (const match of source.matchAll(pattern)) {
    const prefix = match[1] ?? "";
    const text = match[2] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    statements.push({
      start,
      end: start + text.length,
      module: match[3]!,
      text,
    });
  }
  return statements;
}

function replaceNamedClause(
  statement: string,
  requested: string[],
  action: "add" | "remove",
) {
  const current = namedImports(statement);
  const requestedSet = new Set(requested);
  const next =
    action === "add"
      ? sortedNames([...current, ...requested])
      : current.filter((name) => !requestedSet.has(importedName(name)));
  return statement.replace(/\{[\s\S]*?\}/u, `{ ${next.join(", ")} }`);
}

function namedImports(statement: string) {
  return (namedClause(statement)?.[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function namedClause(statement: string) {
  return /\{([\s\S]*?)\}/u.exec(statement);
}

function withoutEmptyNamedClause(statement: string) {
  const clause = statement.replace(/\s*,?\s*\{\s*\}/u, "");
  return /^\s*import\s+(?:type\s+)?from\s/u.test(clause) ? "" : clause;
}

function importInsertionOffset(
  source: string,
  statements: ImportStatement[],
  module: string,
) {
  const later = statements.find(
    (statement) => statement.module.localeCompare(module) > 0,
  );
  if (later) return later.start;
  const last = statements.at(-1);
  if (last) return source[last.end] === "\n" ? last.end + 1 : last.end;
  return directiveBoundary(source);
}

function directiveBoundary(source: string) {
  const match = /^(?:#![^\n]*\n)?(?:(?:["']use [^"']+["'];?[ \t]*\n)+)/u.exec(
    source,
  );
  return match?.[0].length ?? 0;
}

function replacementEdit(
  statement: Pick<ImportStatement, "start" | "end">,
  replacement: string,
) {
  return { start: statement.start, end: statement.end, replacement };
}

function removalEdit(statement: Pick<ImportStatement, "start" | "end">) {
  return { start: statement.start, end: statement.end, replacement: "" };
}

function emptyEdit(): ImportTextEdit {
  return { start: 0, end: 0, replacement: "" };
}

function sortedNames(names: string[]) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort();
}

function importedName(name: string) {
  return name.split(/\s+as\s+/u)[0]!.trim();
}
