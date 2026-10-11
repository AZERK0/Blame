import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';

const checks = {
  'root-backoff': [
    ['delay and cap', '[0,1,3,10].every((a,i)=>m.retryDelay(a,100) === [100,200,800,5000][i]) && m.retryDelay(10,0)===0 && m.retryDelay(0,1000000)===5000'],
    ['invalid attempt and base', '[-1,11,.5,NaN,Infinity].every(a=>rangeError(()=>m.retryDelay(a,100))) && [-1,1000001,.5,NaN,Infinity].every(b=>rangeError(()=>m.retryDelay(1,b)))'],
    ['retry label retained', 'm.RETRY_LABEL==="Retry"'],
  ],
  'child-label': [
    ['trim lowercase and prefix', 'm.assetLabel("  HERO  ")==="asset:hero" && m.assetLabel("\\nÉTÉ\\t")==="asset:été"'],
    ['empty labels rejected', '["","  ","\\n\\t"].every(s=>rangeError(()=>m.assetLabel(s)))'],
    ['prefix retained', 'm.ASSET_PREFIX==="asset:"'],
  ],
  'shared-batch': [
    ['exported settings', 'settings.MAX_BATCH===4 && settings.BATCH_LABEL==="Batch"'],
    ['consumer uses shared setting', 'JSON.stringify(m.splitIds(["a","b","c","d","e","f","g","h","i"]))===\'[["a","b","c","d"],["e","f","g","h"],["i"]]\''],
    ['fresh chunks and input preserved', '(()=>{const input=Object.freeze(["a","b"]),r=m.splitIds(input);return JSON.stringify(input)===\'["a","b"]\'&&JSON.stringify(r)===\'[["a","b"]]\'&&r!==input&&r[0]!==input&&JSON.stringify(m.splitIds([]))==="[]";})()'],
  ],
};
const sourcePaths = {
  'root-backoff': 'src/backoff.ts',
  'child-label': 'packages/labels/src/label.ts',
  'shared-batch': 'src/batches.ts',
};
function load(source, filename, extra = {}) {
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, ...extra });
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }, fileName: filename }).outputText;
  new Script(output).runInContext(context, { timeout: 1000 });
  return module.exports;
}
export async function scenarioChecks(id, workspace) {
  if (!checks[id]) throw new Error('Unknown scope confirmation ' + id);
  const path = sourcePaths[id];
  const source = await readFile(join(workspace, path), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  const name = id === 'root-backoff' ? 'retryDelay' : id === 'child-label' ? 'assetLabel' : 'splitIds';
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  const compact = node => node?.getText(ast).replace(/\s/gu, '');
  const params = id === 'root-backoff' ? ['number','number'] : id === 'child-label' ? ['string'] : ['readonlystring[]'];
  const signature = { name: 'public signature retained', passed: Boolean(fn &&
    fn.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
    fn.parameters.length === params.length && fn.parameters.every((p,i) => compact(p.type) === params[i]) &&
    compact(fn.type) === (id === 'root-backoff' ? 'number' : id === 'child-label' ? 'string' : 'string[][]')) };
  try {
    let settings;
    if (id === 'shared-batch') settings = load(await readFile(join(workspace, 'packages/settings/src/settings.ts'), 'utf8'), 'settings.ts');
    const m = load(source, path, { require: name => {
      if (name === '../packages/settings/src/settings') return settings;
      throw new Error('Unsupported evaluator import');
    } });
    const context = createContext({ m, settings });
    new Script('const rangeError=fn=>{try{fn();return false;}catch(e){return e?.name==="RangeError";}};').runInContext(context, { timeout: 1000 });
    return [signature, ...checks[id].map(([name, expression]) => {
      try { return { name, passed: Boolean(new Script(expression).runInContext(context, { timeout: 1000 })) }; }
      catch { return { name, passed: false }; }
    })];
  } catch {
    return [signature, ...checks[id].map(([name]) => ({ name, passed: false }))];
  }
}
export function scenarioHarnessChecks() { return []; }
