// Post-inspection diagnostic; never replace registered campaign endpoints.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const cases = [
  { input: '"a,b"', expected: ['a,b'] },
  { input: '""', expected: [''] },
  { input: 'a,"b"', expected: ['a', 'b'] },
  { input: '"a""b"', expected: ['a"b'] },
  { input: '" x "', expected: [' x '] },
  { input: '"a",', expected: ['a', ''] },
  { input: ',,""', expected: ['', '', ''] },
  { input: ' a , b ', expected: ['a', 'b'] },
];
const sha = value => createHash('sha256').update(value).digest('hex');
function evaluate(source) {
  const context = createContext({ exports: {}, cases, observations: [] });
  try {
    runInContext(ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, context, { timeout: 1000 });
    runInContext('observations = cases.map(test => ({input:test.input,expected:test.expected,actual:exports.parseCsvRow(test.input)}));', context, { timeout: 1000 });
    const observations = JSON.parse(JSON.stringify(context.observations));
    return { observations, passed: observations.every(x => JSON.stringify(x.actual) === JSON.stringify(x.expected)) };
  } catch (error) { return { passed: false, error: String(error) }; }
}
// Independent offline controls; never written into task workspaces or fed back.
assert.equal(evaluate('export function parseCsvRow(row:string) { const result:string[]=[];let field="",quoted=false,wasQuoted=false;for(let i=0;i<row.length;i++){const c=row[i];if(quoted){if(c===String.fromCharCode(34)){if(row[i+1]===c){field+=c;i++;}else quoted=false;}else field+=c;}else if(c===String.fromCharCode(34)&&field.length===0){quoted=true;wasQuoted=true;}else if(c===","){result.push(wasQuoted?field:field.trim());field="";wasQuoted=false;}else field+=c;}result.push(wasQuoted?field:field.trim());return result;}').passed, true);
assert.equal(evaluate('export function parseCsvRow(row:string) { return row.split(","); }').passed, false);
assert.equal(evaluate('export function parseCsvRow(row:string) { while(true){} }').passed, false);
const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, 'analysis.json'), 'utf8'));
const rows = [];
for (const trial of analysis.rows.filter(row => row.id === 'csv-parser')) {
  const root = join(campaign, trial.name);
  const source = await readFile(join(root, 'workspace/src/csv.ts'), 'utf8');
  rows.push({ name: trial.name, arm: trial.arm, repetition: trial.repetition,
    sourceSha256: sha(source), diffSha256: sha(await readFile(join(root, 'workspace.diff'))),
    instructionSha256: sha(await readFile(join(root, 'instruction.txt'))), ...evaluate(source) });
}
const result = { selection: 'Exploratory diagnostic selected after reviewing T4 global repetition-1 modified source; uniformly applied to every available CSV arm/repetition. Preserves original and registered endpoints; no model feedback or solution retrieval.',
  criterion: 'Well-formed final quoted fields must not create an unrequested extra empty field; preserve escaped quotes, spaces, explicit trailing commas and existing empty fields.',
  controls: { positive: 'passed', negative: 'detected', hang: 'bounded and detected' }, rows };
await writeFile(join(campaign, 'csv-replay.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
