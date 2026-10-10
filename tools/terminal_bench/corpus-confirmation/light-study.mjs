// Reuse the registered driver/scorer/auditor without modifying the original corpus.
// Materialized source hashes are recorded in provenance, including absolute import paths.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(process.env.BLAME_STUDY_WORK_DIRECTORY);
await mkdir(root, { recursive: true });
const local = (name) => new URL(name, import.meta.url).href;
const shared = (name) => new URL(`../corpus/${name}`, import.meta.url).href;
let scorer = await readFile(new URL(shared('score-run.mjs')), 'utf8');
scorer = scorer.replace('"./corpus-utils.mjs"', JSON.stringify(shared('corpus-utils.mjs')))
  .replace('"./scenario-checks.mjs"', JSON.stringify(local('scenario-checks.mjs')));
await writeFile(join(root,'score-run.mjs'),scorer);
let driver = await readFile(new URL(shared('light-study.mjs')), 'utf8');
driver = driver.replace('"./corpus-utils.mjs"', JSON.stringify(local('corpus-utils.mjs')))
  .replace('"./score-run.mjs"', JSON.stringify(pathToFileURL(join(root,'score-run.mjs')).href))
  .replace('"./light-study-accounting.mjs"', JSON.stringify(shared('light-study-accounting.mjs')));
await writeFile(join(root,'driver.mjs'),driver);
let auditor = await readFile(new URL(shared('light-study-audit.mjs')), 'utf8');
auditor = auditor.replace('new URL("./manifest.json", import.meta.url)', `new URL(${JSON.stringify(local('manifest.json'))})`);
await writeFile(join(root,'auditor.mjs'),auditor);
const mode = process.argv[2];
if (mode === 'prepare') process.exit(0);
const file = join(root, mode === 'audit' ? 'auditor.mjs' : 'driver.mjs');
const args = mode === 'audit' ? [join(root,'pilot')] : process.argv.slice(2);
const result = spawnSync(process.execPath,[file,...args],{stdio:'inherit',env:process.env});
process.exitCode = result.status ?? 1;
