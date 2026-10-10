// Exploratory Unicode counterexample, kept separate from registered endpoints.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, 'analysis.json'), 'utf8'));
const rows = [];
for (const trial of analysis.rows.filter(row => row.id === 'slug-contract')) {
  const source = await readFile(join(campaign, trial.name, 'workspace/src/slug.ts'), 'utf8');
  const cases = [
    { title: 'Café déjà vu', expected: 'cafe-deja-vu' },
    { title: 'a\u1ab0b', expected: 'ab' },
    { title: 'a\ufe20b', expected: 'ab' },
  ];
  const context = createContext({ exports: {}, cases, observations: [] });
  runInContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, context, { timeout: 1000 });
  runInContext(`observations = cases.map(test => ({title: test.title,
    actual: exports.slugifyProject({id: "example", title: test.title}), expected: test.expected}));`,
    context, { timeout: 1000 });
  const observations = JSON.parse(JSON.stringify(context.observations));
  rows.push({ name: trial.name, sourceSha256: createHash('sha256').update(source).digest('hex'),
    observations, passed: observations.every(test => test.actual === test.expected) });
}
const result = {
  selection: 'Exploratory after inspecting the first-repetition modified slug source; applied uniformly to every available arm/repetition. Not a preregistered endpoint, no score replacement or task-agent feedback.',
  criterion: 'Remove extended combining diacritics U+1AB0 and U+FE20 as well as ordinary decomposed Latin accents.',
  rows,
};
await writeFile(join(campaign, 'slug-replay.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
