import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, "analysis.json"), "utf8"));
const rows = [];
for (const trial of analysis.rows.filter((row) => row.id === "large-create")) {
  const source = await readFile(join(campaign, trial.name, "workspace/src/project-seed.ts"), "utf8");
  const ast = ts.createSourceFile("project-seed.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(ts.isVariableStatement).flatMap((statement) => statement.declarationList.declarations);
  const declaration = declarations.find((node) => node.name.getText(ast) === "PROJECT_SEEDS");
  let value = declaration?.initializer;
  while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
  const elements = value && ts.isArrayLiteralExpression(value) ? value.elements : [];
  const mismatches = [];
  const extraFields = new Set();
  for (const [index, element] of elements.entries()) {
    const fields = ts.isObjectLiteralExpression(element) ? Object.fromEntries(element.properties.map((property) =>
      ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
        ? [property.name.getText(ast).replace(/^['"]|['"]$/g, ""), property.initializer.text]
        : ["<nonliteral>", null])) : {};
    const number = String(index + 1).padStart(3, "0");
    if (fields.id !== `project-${number}` || fields.title !== `Project ${number}` || fields.status !== "published" || "<nonliteral>" in fields)
      mismatches.push({ index, fields });
    for (const field of Object.keys(fields)) if (!["id", "title", "status"].includes(field)) extraFields.add(field);
  }
  rows.push({ name: trial.name, sourceSha256: createHash("sha256").update(source).digest("hex"), bytes: Buffer.byteLength(source),
    topLevelStatementKinds: ast.statements.map((node) => ts.SyntaxKind[node.kind]), literalEntries: elements.length,
    mismatches, extraFields: [...extraFields], passed: Buffer.byteLength(source) > 10000 && elements.length === 120 && mismatches.length === 0 });
}
const result = { method: "Independent static AST audit of every literal entry and exact id/title/status sequence; comments and type declarations do not count as data. Additional literal fields are reported, since the instruction does not prohibit them. Exported type, source scope, readability and executed build remain manual audit obligations.", rows };
await writeFile(join(campaign, "seed-audit.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
