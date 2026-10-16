import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export const repo = resolve(import.meta.dirname, '../../..');
export const work = join(repo, '.blame/research/iterative-f38');
export const study = join(repo, 'docs/experiments/light-harness-iterative-f38-2026-10-16');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = path => readFile(path, 'utf8').then(JSON.parse);
export const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

export async function prepare(root, task) {
  await mkdir(root, { recursive: true });
  execFileSync('tar', ['-xzf', join(work, 'upstream/axios.tar.gz'), '--strip-components=1', '-C', root]);
  await symlink(join(work, 'dependencies/node_modules'), join(root, 'node_modules'));
  await mkdir(join(root, '.study'));
  for (const name of ['feature', 'regression']) await cp(join(import.meta.dirname, `${name}.mjs`), join(root, `.study/${name}.mjs`));
  const pkg = await json(join(root, 'package.json'));
  pkg.scripts['test:study:feature'] = 'node --test --test-timeout=5000 .study/feature.mjs';
  pkg.scripts['test:study:regression'] = 'node --test --test-timeout=5000 .study/regression.mjs';
  pkg.scripts['test:study:types'] = 'node node_modules/typescript/bin/tsc --noEmit -p .study/tsconfig.json';
  await save(join(root, 'package.json'), pkg);
  await save(join(root, '.study/task.json'), { id: task });
  await save(join(root, 'lib/jsconfig.json'), { compilerOptions: { allowJs: true, checkJs: false, target: 'ES2022',
    module: 'NodeNext', moduleResolution: 'NodeNext', types: ['node'] }, include: ['**/*.js'] });
  await save(join(root, '.study/tsconfig.json'), { compilerOptions: { strict: true, noEmit: true, target: 'ES2022',
    module: 'NodeNext', moduleResolution: 'NodeNext', types: ['node'], skipLibCheck: false }, include: ['types.mts', 'types.cts'] });
  for (const [ext, imported] of [['mts', 'import axios from "../index.js";'], ['cts', 'import axios = require("../index.cjs");']]) {
    const body = task === 'clear-count'
      ? 'const requestCount: number = axios.interceptors.request.clear();\nconst responseCount: number = axios.interceptors.response.clear();\nvoid requestCount; void responseCount;\n'
      : 'axios.get("/local", {requireFormDataLength: true});\naxios.get("/local", {requireFormDataLength: false});\n// @ts-expect-error The option is boolean.\naxios.get("/local", {requireFormDataLength: "yes"});\n';
    await writeFile(join(root, `.study/types.${ext}`), imported + '\n' + body);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeFile(join(root, '.git/info/exclude'), '.blame/\nnode_modules/\n');
  // Keep the supplied checks tracked even if an upstream ignore pattern covers them.
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['add', '-f', '.study', 'lib/jsconfig.json'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Study', '-c', 'user.email=study@example.invalid', 'commit', '--quiet', '-m', 'Frozen Axios feature input'],
    { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-16T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-16T00:00:00Z' } });
}

// Independent positive/negative oracle controls, never copied into model inputs.
export async function positive(root, task) {
  if (task === 'clear-count') {
    const path = join(root, 'lib/core/InterceptorManager.js'), text = await readFile(path, 'utf8');
    const old = '  clear() {\n    if (this.handlers) {\n      this.handlers = [];\n    }\n  }';
    if (text.split(old).length !== 2) throw Error('Positive clear anchor changed');
    await writeFile(path, text.replace(old, '  clear() {\n    const count = this.handlers.filter(Boolean).length;\n    this.handlers = [];\n    return count;\n  }'));
  } else {
    const path = join(root, 'lib/adapters/http.js'); let text = await readFile(path, 'utf8');
    const old = `      if (!headers.hasContentLength()) {
        try {
          const knownLength = await util.promisify(data.getLength).call(data);
          Number.isFinite(knownLength) && knownLength >= 0 && headers.setContentLength(knownLength);
          /*eslint no-empty:0*/
        } catch (e) {
        }
      }`;
    const next = `      if (config.requireFormDataLength || !headers.hasContentLength()) {
        try {
          const knownLength = await util.promisify(data.getLength).call(data);
          if (config.requireFormDataLength && !(Number.isFinite(knownLength) && knownLength >= 0)) {
            throw new Error('Invalid legacy form-data length');
          }
          Number.isFinite(knownLength) && knownLength >= 0 && headers.setContentLength(knownLength, false);
        } catch (e) {
          if (config.requireFormDataLength) return reject(AxiosError.from(e, AxiosError.ERR_BAD_REQUEST, config));
        }
        if (config.requireFormDataLength && isDone) return;
      }`;
    if (text.split(old).length !== 2) throw Error('Positive form-data anchor changed');
    text = text.replace(old, next); await writeFile(path, text);
  }
  for (const name of ['index.d.ts', 'index.d.cts']) {
    const path = join(root, name); let text = await readFile(path, 'utf8');
    if (task === 'clear-count') text = text.replace('clear(): void;', 'clear(): number;');
    else text = text.replace(/(\s+maxBodyLength\?: number;)/u, '$1\n  requireFormDataLength?: boolean;');
    await writeFile(path, text);
  }
}

if (process.argv[1] === import.meta.filename && process.argv[2] === 'controls') {
  const { spawnSync } = await import('node:child_process');
  const results = [];
  for (const task of ['clear-count', 'form-length']) {
    const root = join(work, 'controls', task);
    await rm(root, { recursive: true, force: true });
    await prepare(root, task);
    const run = script => {
      const result = spawnSync('npm', ['run', script], { cwd: root, encoding: 'utf8', timeout: 30000 });
      return { script, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.code ?? null };
    };
    const before = ['test:study:feature', 'test:study:types', 'test:study:regression'].map(run);
    await positive(root, task);
    const after = ['test:study:feature', 'test:study:types', 'test:study:regression'].map(run);
    const diff = execFileSync('git', ['diff', 'HEAD', '--'], { cwd: root });
    await writeFile(join(study, `positive-${task}.patch`), diff);
    results.push({ task, before, after });
  }
  await save(join(study, 'oracle-controls.json'), results);
  console.log(JSON.stringify(results.map(row => ({ task: row.task, before: row.before.map(r => r.exitCode), after: row.after.map(r => r.exitCode) }))));
  if (results.some(row => row.before[0].exitCode !== 1 || row.before[1].exitCode === 0 || row.before[2].exitCode !== 0 || row.after.some(r => r.exitCode !== 0))) process.exitCode = 1;
}
