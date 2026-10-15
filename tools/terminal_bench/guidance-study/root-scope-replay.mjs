// Diagnostic only: explain recorded root-star queries without changing production.
// Separate synthetic workspace; never touches a paid trial or sends model requests.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {work} from './paths.mjs';
const {LightWorkspace}=await import(join(work,'frozen/f28/bundle/agent-runtime/dist/harness/light-workspace.js'));
const root=await mkdtemp(join(tmpdir(),'blame-root-scope-'));
try{
 await mkdir(join(root,'src'));
 for(const [path,text]of Object.entries({
  'README.md':'Fixture root file: no matching identifier.\n',
  'package.json':'{"type":"module"}',
  'tsconfig.json':JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',noEmit:true,types:[]},include:['src/**/*.ts']}),
  'src/declaration.ts':'export function calculate(value: number) { return value + 1; }\n',
  'src/consumer.ts':'import { calculate } from "./declaration.js";\nexport const answer = calculate(1);\n'
 }))await writeFile(join(root,path),text);
 const workspace=new LightWorkspace(root,{sessionId:'root-scope-diagnostic'}),rows=[];
 for(const mode of ['text','references'])for(const scope of ['*','**',undefined]){
  const input={query:mode==='references'?'src/declaration.ts#calculate':'calculate',mode,...(scope?{scope}:{})};
  const result=await workspace.searchCode(input);assert.equal(result.status,'ok');
  rows.push({input,...result.data});
 }
 for(const mode of ['text','references']){
  const subset=rows.filter(r=>r.input.mode===mode),star=subset.find(r=>r.input.scope==='*');
  assert(star.candidateCount>0);assert.equal(star.results.length,0);
  assert.notEqual(star.scopeStatus,'empty');
  const recursive=subset.find(r=>r.input.scope==='**'),all=subset.find(r=>r.input.scope===undefined);
  assert(recursive.results.length>0);assert.equal(recursive.results.length,all.results.length);
 }
 const output={paidRequests:0,productionChanged:false,
  conclusion:'The star glob selects only root files even when it selects a nonempty set. A zero-result root-only search does not establish absence in descendants. Recursive double-star or omitted scope reaches the nested references. Empty-scope guidance alone cannot resolve this case.',rows};
 console.log(JSON.stringify(output,null,2));
}finally{await rm(root,{recursive:true,force:true});}
