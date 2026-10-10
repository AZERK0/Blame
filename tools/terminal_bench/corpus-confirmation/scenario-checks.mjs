import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';
const files = { 'cents-allocation':'src/allocation.ts', 'revision-guard':'src/revision.ts', 'retry-backoff':'src/backoff.ts' };
const cases = {
  'cents-allocation': [
    ['stable remainder and zero', `JSON.stringify(m.allocateCents(10,3))==='[4,3,3]' && JSON.stringify(m.allocateCents(0,3))==='[0,0,0]' && JSON.stringify(m.allocateCents(2,4))==='[1,1,0,0]'`],
    ['sum, count and balanced safe integers', `[ [97,7], [101,100], [Number.MAX_SAFE_INTEGER,10000], [1,1] ].every(([total,n])=>{const parts=m.allocateCents(total,n); return parts.length===n && parts.every(x=>Number.isSafeInteger(x)&&x>=0) && parts.reduce((a,b)=>a+b,0)===total && Math.max(...parts)-Math.min(...parts)<=1 && parts.every((x,i)=>i===0 || parts[i-1]>=x);})`],
    ['invalid inputs throw RangeError', `[[ -1,2 ],[1.5,2],[NaN,2],[Infinity,2],[Number.MAX_SAFE_INTEGER+1,2],[10,0],[10,-1],[10,2.5],[10,NaN],[10,Infinity],[10,10001]].every(([total,n])=>rangeError(()=>m.allocateCents(total,n)))`],
  ],
  'revision-guard': [
    ['older/equal preserve identity', `[0,3].every(revision=>{const s=Object.freeze({revision:3,title:'old',owner:'Ada'});return m.applyRevision(s,Object.freeze({revision,title:'ignored'}))===s;})`],
    ['new revision immutable and owner preserved', `(()=>{const s=Object.freeze({revision:3,title:'old',owner:'Ada'}),u=Object.freeze({revision:4,title:'new'}),v=m.applyRevision(s,u);return v!==s&&v!==u&&v.revision===4&&v.title==='new'&&v.owner==='Ada'&&s.title==='old'&&u.title==='new';})()`],
    ['invalid revisions throw RangeError', `[-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1].every(revision=>rangeError(()=>m.applyRevision({revision:3,title:'old',owner:'Ada'},{revision,title:'x'})))`],
  ],
  'retry-backoff': [
    ['exponential delay and saturation', `[0,1,2,5,6,12,1024,Number.MAX_SAFE_INTEGER].every((n,i)=>m.retryDelay(n)===[200,400,800,6400,10000,10000,10000,10000][i])`],
    ['invalid attempts throw RangeError', `[-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1].every(n=>rangeError(()=>m.retryDelay(n)))`],
    ['shouldRetry preserved', `[200,400,429,499,500,503,600].every((n,i)=>m.shouldRetry(n)===[false,false,true,false,true,true,true][i])`],
  ],
};
export async function scenarioChecks(id, workspace) {
  if (id==='card-hierarchy') {
    const source=(await readFile(join(workspace,'src/card.css'),'utf8')).replace(/\/\*[\s\S]*?\*\//gu,'');
    const expected={'.project-card':{'background':'#f8fafc','color':'#0f172a','padding':'24px','border-radius':'12px'},'.project-card__title':{'font-size':'24px','font-weight':'700','margin':'0','line-height':'1.25'},'.project-card__action':{'color':'#1d4ed8','text-decoration':'underline','text-underline-offset':'3px'}};
    return Object.entries(expected).map(([selector, declarations])=>{
      const rules=[...source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(x=>x[1].trim()===selector);
      const actual=Object.fromEntries(rules.flatMap(x=>x[2].split(';').filter(x=>x.includes(':')).map(x=>{const i=x.indexOf(':');return [x.slice(0,i).trim().toLowerCase(),x.slice(i+1).trim().toLowerCase()];})));
      return {name:`declared ${selector} values`,passed:Object.entries(declarations).every(([key,value])=>actual[key]===value)};
    });
  }
  if (!files[id]) throw new Error(`Unknown confirmation case ${id}`);
  const source=await readFile(join(workspace,files[id]),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};const context=createContext({module,exports:module.exports});
  try {new Script(compiled).runInContext(context,{timeout:1000});} catch {return cases[id].map(([name])=>({name,passed:false}));}
  new Script("const m=module.exports; const rangeError=(fn)=>{try{fn();return false;}catch(e){return e?.name==='RangeError';}};").runInContext(context);
  return cases[id].map(([name,expression])=>{try{return {name,passed:Boolean(new Script(expression).runInContext(context,{timeout:1000}))};}catch{return {name,passed:false};}});
}
export function scenarioHarnessChecks() { return []; }
