import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';

const cases = {
  'interval-union': [
    ['empty and fresh singleton', `(()=>{const t=Object.freeze([1,2]),a=Object.freeze([t]),r=m.mergeRanges(a);return JSON.stringify(m.mergeRanges([]))==='[]'&&JSON.stringify(r)==='[[1,2]]'&&r!==a&&r[0]!==t;})()`],
    ['sorted overlap, containment and equal endpoints', `JSON.stringify(m.mergeRanges([[8,10],[2,4],[1,3],[4,7],[3,3],[8,10]]))==='[[1,7],[8,10]]'`],
    ['negative and disjoint integer-adjacent endpoints', `JSON.stringify(m.mergeRanges([[3,4],[-5,-2],[1,2],[-3,0]]))==='[[-5,0],[1,2],[3,4]]'`],
    ['input immutability and no tuple reuse', `(()=>{const a=Object.freeze([Object.freeze([5,9]),Object.freeze([1,5]),Object.freeze([20,21])]),r=m.mergeRanges(a);return JSON.stringify(a)==='[[5,9],[1,5],[20,21]]'&&JSON.stringify(r)==='[[1,9],[20,21]]'&&r.every(t=>!a.includes(t));})()`],
    ['safe bounds and invalid endpoints', `JSON.stringify(m.mergeRanges([[-Number.MAX_SAFE_INTEGER,0],[0,Number.MAX_SAFE_INTEGER]]))===JSON.stringify([[-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]]) && [[2,1],[0,NaN],[Infinity,2],[0,1.5],[0,Number.MAX_SAFE_INTEGER+1]].every(t=>rangeError(()=>m.mergeRanges([t])))`],
  ],
  'duration-format': [
    ['seconds truncation and minute boundary', `[0,999,1000,59999,60000].every((n,i)=>m.formatDuration(n)===['00:00:00','00:00:00','00:00:01','00:00:59','00:01:00'][i])`],
    ['large hours never wrap', `[3599999,3600000,86400000,360000001,Number.MAX_SAFE_INTEGER].every((n,i)=>m.formatDuration(n)===['00:59:59','01:00:00','24:00:00','100:00:00','2501999792:59:00'][i])`],
    ['invalid values throw RangeError', `[-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1].every(n=>rangeError(()=>m.formatDuration(n)))`],
    ['label preserved', `m.DURATION_LABEL==='Elapsed'`],
  ],
};
export async function scenarioChecks(id, workspace) {
  if (id === 'notification-config') {
    let value;
    try {value=JSON.parse(await readFile(join(workspace,'src/notifications.json'),'utf8'));}
    catch {return [{name:'valid JSON and exact requested configuration',passed:false}];}
    const expected={delivery:{retryLimit:4,timeoutMs:5000,channel:'email'},features:{digest:true,marketing:false},metadata:{owner:'operations',schemaVersion:1}};
    const canonical=x=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
    return [{name:'valid JSON and exact requested configuration',passed:JSON.stringify(canonical(value))===JSON.stringify(canonical(expected))}];
  }
  const file={'interval-union':'intervals.ts','duration-format':'duration.ts'}[id];
  if (!file) throw new Error(`Unknown T2 confirmation case ${id}`);
  const source=await readFile(join(workspace,'src',file),'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true);
  const name=id==='interval-union'?'mergeRanges':'formatDuration';
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  const compact=n=>n?.getText(ast).replace(/\s/gu,'');
  const exported=n=>n?.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
  const alias=ast.statements.find(n=>ts.isTypeAliasDeclaration(n)&&n.name.text==='Range');
  const signature={name:'public types and signature preserved',passed:Boolean(fn&&exported(fn)&&fn.parameters.length===1&&
    (id==='interval-union'
      ? compact(fn.parameters[0].type)==='readonlyRange[]'&&compact(fn.type)==='Range[]'&&exported(alias)&&compact(alias.type)==='readonly[number,number]'
      : compact(fn.parameters[0].type)==='number'&&compact(fn.type)==='string'))};
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}},context=createContext({module,exports:module.exports});
  try {new Script(compiled).runInContext(context,{timeout:1000});}
  catch {return [signature,...cases[id].map(([name])=>({name,passed:false}))];}
  new Script("const m=module.exports;const rangeError=fn=>{try{fn();return false;}catch(e){return e?.name==='RangeError';}};").runInContext(context,{timeout:1000});
  return [signature,...cases[id].map(([name,expression])=>{
    try {return {name,passed:Boolean(new Script(expression).runInContext(context,{timeout:1000}))};}
    catch {return {name,passed:false};}
  })];
}
export function scenarioHarnessChecks() {return [];}
