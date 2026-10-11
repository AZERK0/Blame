// Post-hoc valid-URI counterexample; original registered endpoints stay unchanged.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, 'analysis.json'), 'utf8'));
const cases = [
  { input: 'projects//2026/./hero.jpg', expected: 'projects/2026/hero.jpg' },
  { input: 'projects/100%25-ready.txt', expected: 'projects/100%-ready.txt' },
  { input: 'projects/%ZZ/secret', expected: null },
  { input: 'projects/%2e%2e/secret', expected: null },
];
const rows = [];
for (const trial of analysis.rows.filter(row => row.id === 'storage-traversal')) {
  const source = await readFile(join(campaign, trial.name, 'workspace/src/storage-path.ts'));
  const instruction = await readFile(join(campaign, trial.name, 'instruction.txt'));
  const diff = await readFile(join(campaign, trial.name, 'workspace.diff'));
  const context = createContext({ exports: {}, cases, observations: [] });
  runInContext(ts.transpileModule(source.toString(), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, context, { timeout: 1000 });
  runInContext(`observations = cases.map(test => {
    try { return {...test, actual: exports.normalizeStorageKey(test.input)}; }
    catch (error) { return {...test, error: String(error)}; }
  });`, context, { timeout: 1000 });
  const observations = JSON.parse(JSON.stringify(context.observations));
  rows.push({ name: trial.name, sourceSha256: createHash('sha256').update(source).digest('hex'),
    instructionSha256: createHash('sha256').update(instruction).digest('hex'), observations,
    diffSha256: createHash('sha256').update(diff).digest('hex'),
    passed: observations.every(test => !test.error && test.actual === test.expected) });
}
const result = {
  selection: 'Post-hoc after inspecting second-repetition modified storage source. Applied uniformly to all six global sources, with identical valid-input and failure controls. Not a registered endpoint; no original score replacement, source repair, or task-agent feedback.',
  criterion: 'A valid URI-encoded literal percent in an otherwise normal relative key is not an invalid input encoding. One valid initial decode produces a literal percent; unsuccessfully attempting another decode must not turn that valid key into null. Does not adjudicate double-encoded traversal or arbitrary nested-decoding conventions.',
  rows,
};
await writeFile(join(campaign, 'storage-percent-replay.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
