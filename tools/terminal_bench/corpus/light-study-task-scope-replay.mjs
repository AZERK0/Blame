import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const runtimes = process.argv.slice(2).map(path => resolve(path));
assert.equal(runtimes.length, 2);
const modules = await Promise.all(runtimes.map(async runtime => ({
  briefing: (await import(pathToFileURL(join(runtime,'dist/harness/initial-task-briefing.js')))).createInitialTaskBriefing,
  catalog: (await import(pathToFileURL(join(runtime,'dist/harness/task-catalog.js')))).readTaskCatalog,
})));
const results = [];
for (const nested of [false,true]) {
  const root = await mkdtemp(join(tmpdir(),'blame-scope-briefing-'));
  try {
    await writeFile(join(root,'package.json'),JSON.stringify({name:'scope-root',scripts:{build:'node --version',test:'node --test',dev:'node --version'}}));
    await writeFile(join(root,'value.ts'),'export const value = 1;\n');
    if (nested) {
      await mkdir(join(root,'packages/child'),{recursive:true});
      await writeFile(join(root,'packages/child/package.json'),JSON.stringify({name:'scope-child',scripts:{build:'node --version'}}));
    }
    const input = { workspaceRoot:root, taskContract:{objective:'Change only value.ts'} };
    const [baseline,modified] = await Promise.all(modules.map(m => m.briefing(input)));
    assert.equal(typeof baseline,'string'); assert.equal(typeof modified,'string');
    const extra = modified.split('\n').filter(l => l.startsWith('Task scopes (execution directories): '));
    assert.equal(extra.length,nested?1:0);
    assert.equal(modified.split('\n').filter(l => !extra.includes(l)).join('\n'),baseline);
    assert.equal(modified.split('\n').find(l => l.startsWith('Task IDs:')),baseline.split('\n').find(l => l.startsWith('Task IDs:')));
    if (nested) {
      const tasks = (await modules[1].catalog(root)).filter(t=>!['dependencies','service'].includes(t.kind)).slice(0,16);
      for (const task of tasks) assert.ok(extra[0].includes(task.task_id+' -> '+task.cwd));
      assert.ok(extra[0].includes('scope-child:build -> packages/child'));
      assert.equal(tasks.some(t=>t.kind==='service'),false);
    } else assert.equal(modified,baseline);
    assert.equal(await readFile(join(root,'value.ts'),'utf8'),'export const value = 1;\n');
    results.push({nested,rootOnlyByteIdentical:!nested,originalLinesPreserved:true,visibleTaskScopesCorrect:true,noSourceMutation:true});
  } finally {await rm(root,{recursive:true,force:true});}
}
console.log(JSON.stringify({runtimes,results,scope:'Briefing presentation mechanism only; no model choice, dependency independence or completion-policy certificate.'}));
