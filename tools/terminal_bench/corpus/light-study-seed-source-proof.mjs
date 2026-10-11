// Expand the static seed audit for complete input/source review without omitting other code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, 'analysis.json')));
const ledger = JSON.parse(await readFile(join(campaign, 'tool-ledger.json')));
const sha = value => createHash('sha256').update(value).digest('hex');
const rows = [];
for (const trial of analysis.rows.filter(row => row.id === 'large-create')) {
  const source = await readFile(join(campaign, trial.name, 'workspace/src/project-seed.ts'), 'utf8');
  const ast = ts.createSourceFile('project-seed.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(s => s.declarationList.declarations)
    .find(d => d.name.getText(ast) === 'PROJECT_SEEDS');
  let array = declaration?.initializer;
  while (array && (ts.isAsExpression(array) || ts.isSatisfiesExpression(array) || ts.isParenthesizedExpression(array))) array = array.expression;
  assert.ok(array && ts.isArrayLiteralExpression(array));
  assert.equal(array.elements.length, 120);
  const extras = [];
  for (const [index, entry] of array.elements.entries()) {
    assert.ok(ts.isObjectLiteralExpression(entry));
    const fields = {};
    for (const property of entry.properties) {
      assert.ok(ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name));
      assert.ok(ts.isStringLiteral(property.initializer));
      const key = ts.isIdentifier(property.name) ? property.name.text : property.name.text;
      assert.equal(typeof key, 'string');
      assert.ok(!Object.hasOwn(fields, key), 'Duplicate field');
      fields[key] = property.initializer.text;
    }
    const number = String(index + 1).padStart(3, '0');
    assert.equal(fields.id, `project-${number}`);
    assert.equal(fields.title, `Project ${number}`);
    assert.equal(fields.status, 'published');
    const additional = Object.fromEntries(Object.entries(fields).filter(([key]) => !['id', 'title', 'status'].includes(key)));
    if (Object.keys(additional).length) extras.push({ index, fields: additional });
  }
  const bindings = [];
  for (const [index, tool] of ledger.find(row => row.name === trial.name).tools.entries()) {
    let candidate;
    if (tool.tool === 'edit_code' && tool.input.operations?.length === 1) {
      const operation = tool.input.operations[0];
      if (operation.kind === 'patch' && operation.path === 'src/project-seed.ts') candidate = operation.patch;
    }
    if (tool.tool === 'apply_patch') candidate = tool.input.input;
    if (typeof candidate !== 'string') continue;
    if (candidate.startsWith('*** Begin Patch')) {
      const lines = candidate.split('\n');
      if (lines.filter(line => /^\*\*\* (Add|Update|Delete) File:/.test(line)).length !== 1) continue;
      const start = lines.findIndex(line => /^\*\*\* Add File: .*src\/project-seed\.ts$/.test(line));
      const end = lines.indexOf('*** End Patch', start);
      if (start < 0 || end < 0 || !lines.slice(start + 1, end).every(line => line.startsWith('+'))) continue;
      candidate = lines.slice(start + 1, end).map(line => line.slice(1)).join('\n');
      if (source.endsWith('\n')) candidate += '\n';
    }
    if (candidate === source) bindings.push({ toolIndex: index, inputSha256: sha(JSON.stringify(tool.input)), sourceSha256: sha(source) });
  }
  rows.push({ name: trial.name, sourceSha256: sha(source), bytes: Buffer.byteLength(source),
    exactStaticEntries: 120, extras, bindings,
    nonArraySourceForManualReview: source.slice(0, array.getStart(ast)) + '[/* All 120 literal records independently verified above. */]' + source.slice(array.end) });
}
const result = { method: 'Every entry and every property checked statically, excluding getters/spreads/computed names/executable initializers/duplicate fields. Additional literal fields fully reported; no narrowing of allowed extras. Show all code outside the verified array and require manual scope/export/build review. Exact effective-input bytes bind only one-file creations equal to final source; other inputs must be reviewed in full. Diagnostic helper, not a new model endpoint.', rows };
await writeFile(join(campaign, 'seed-source-proof.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
